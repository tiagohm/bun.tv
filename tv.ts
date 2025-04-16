export interface Channel {
	readonly url: string
	readonly name: string
	readonly logo?: string
}

const INPUT_UPDATE_INTERVAL = 1000 * 60 * 60 * 12
const NAME_REGEX = /tvg-name="([^"]+)"/
const LOGO_REGEX = /tvg-logo="([^"]+)"/

const INPUT_FILE = Bun.file('tv.m3u8')

const IGNORE_NAMES = ['SD', 'FHD', '4K', '24H']
const IGNORE_EXTENSIONS = ['.mp4', '.mkv', '.avi']

export class Tv {
	private readonly channels = new Map<string, Channel>()
	private process: Bun.Subprocess | undefined = undefined

	list() {
		return Array.from(this.channels.values())
	}

	get(name: string) {
		return this.channels.get(name)
	}

	clear() {
		this.channels.clear()
	}

	async kill() {
		if (this.process) {
			this.process?.kill('SIGKILL')
			await this.process.exited
			this.process = undefined
		}
	}

	async load(text?: string) {
		this.clear()

		if (!text) {
			if (await INPUT_FILE.exists()) {
				text = await INPUT_FILE.text()
			}
		}

		if (text) {
			const m3u8 = text.split('\n')

			for (let i = 0; i < m3u8.length; i++) {
				const line = m3u8[i]

				if (line.startsWith('#EXTINF')) {
					const matcher = NAME_REGEX.exec(line)

					if (matcher?.length) {
						const logo = LOGO_REGEX.exec(line)?.[1]

						const url = m3u8[i + 1].trim()
						const name = matcher[1].trim().toUpperCase()

						if (IGNORE_EXTENSIONS.findIndex((e) => url.endsWith(e)) < 0 && IGNORE_NAMES.findIndex((e) => name.includes(e)) < 0) {
							this.channels.set(name, { url, name, logo })
						}

						i++
					}
				}
			}
		}

		console.info('channels: %d', this.channels.size)

		Bun.gc(true)
	}

	async download(url?: string, force: boolean = false) {
		let text: string | undefined

		if (force || !(await INPUT_FILE.exists()) || Date.now() - INPUT_FILE.lastModified >= INPUT_UPDATE_INTERVAL) {
			console.info('downloading...')
			const response = await fetch(url || Bun.env.IPTV_URL)
			text = await response.text()
			INPUT_FILE.write(text)
		}

		return this.load(text)
	}

	async play(name: string) {
		const channel = this.channels.get(name)

		if (!channel) return false

		await this.kill()

		const commands = [Bun.env.FFPLAY || 'ffplay', '-fflags', 'nobuffer', '-flags', 'low_delay', '-framedrop', '-probesize', '1000000', '-analyzeduration', '2000000', '-hide_banner', '-fs', '-window_title', channel.name]

		if (Bun.env.IPTV_OUTPUT_TYPE === 'hls') commands.push('-infbuf')
		else commands.push('-noinfbuf')
		commands.push(channel.url)

		const p = Bun.spawn(commands, {
			stdout: 'ignore',
			stderr: 'pipe',
		})

		console.info('playing channel: %s (%d)', name, p.pid)

		const reader = p.stderr.getReader()
		const decoder = new TextDecoder('utf-8')

		let currentTimestamp = 0
		let lastTimestamp = 0

		const timer = setInterval(async () => {
			if (currentTimestamp) {
				console.info('time: %d s', currentTimestamp)

				if (lastTimestamp === 0) {
					lastTimestamp = currentTimestamp
				} else if (currentTimestamp === lastTimestamp) {
					console.info('restarting channel: %s', name)
					await reader.cancel()
					clearInterval(timer)
					await this.play(name)
				} else {
					lastTimestamp = currentTimestamp
				}
			}
		}, 15000)

		p.exited.then((code) => {
			console.info('exited: %d', code)
			clearInterval(timer)
		})

		reader.read().then(function read({ done, value }): unknown {
			if (done) return

			const line = decoder.decode(value)
			const index = line.indexOf('A-V')

			if (index) {
				const timestamp = +line.substring(0, index - 1)

				if (timestamp) {
					currentTimestamp = Math.trunc(timestamp)
				}
			}

			return reader.read().then(read)
		})

		this.process = p

		return true
	}
}
