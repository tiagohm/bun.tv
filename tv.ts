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
	private process: Bun.Subprocess | undefined
	private channel: Channel | undefined
	private starting = false
	private playing = false

	list() {
		return Array.from(this.channels.values())
	}

	get(name: string) {
		return this.channels.get(name)
	}

	clear() {
		this.channels.clear()
	}

	async kill(name = this.channel?.name) {
		if (this.process) {
			this.process?.kill('SIGKILL')
			await this.process.exited
			this.process = undefined

			if (name && process.platform === 'win32') {
				Bun.spawnSync(['taskkill', '/F', '/FI', `WindowTitle eq ${name}`, '/T'])
				await Bun.sleep(1000)
			}
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
			let i = 0

			while (i < text.length) {
				const a = text.indexOf('\n', i)

				if (a < 0) break

				const line = text.substring(i, a)

				if (line.startsWith('#EXTINF')) {
					const matcher = NAME_REGEX.exec(line)

					if (matcher?.length) {
						const b = text.indexOf('\n', a + 1)

						if (b > a) {
							const logo = LOGO_REGEX.exec(line)?.[1]
							const url = text.substring(a + 1, b).trim()
							const name = matcher[1].trim().toUpperCase()

							if (IGNORE_EXTENSIONS.findIndex((e) => url.endsWith(e)) < 0 && IGNORE_NAMES.findIndex((e) => name.includes(e)) < 0) {
								this.channels.set(name, { url, name, logo })
							}

							i = b + 1
							continue
						}
					}
				}

				i = a + 1
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

	async play(name: string, restarted: boolean = false) {
		const channel = this.channels.get(name)

		if (!channel || this.starting) return false

		this.starting = true

		await this.kill()

		this.channel = channel

		const commands = [Bun.env.FFPLAY || 'ffplay', '-nostats', '-fflags', 'nobuffer', '-flags', 'low_delay', '-framedrop', '-probesize', '1000000', '-analyzeduration', '2000000', '-hide_banner', '-fs', '-window_title', channel.name, '-sync', 'video']

		if (Bun.env.IPTV_OUTPUT_TYPE === 'hls') commands.push('-infbuf')
		commands.push(channel.url)

		const p = Bun.spawn(commands, {
			stdout: 'ignore',
			stderr: 'pipe',
		})

		this.playing = true

		console.info('%splaying channel: %s (%d)', restarted ? 're' : '', name, p.pid)

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
					await reader.cancel()
					clearInterval(timer)
					await this.play(name, true)
				} else {
					lastTimestamp = currentTimestamp
				}
			}
		}, 6000)

		this.starting = false

		p.exited.then(async (code) => {
			console.info('exited: %d', code)
			clearInterval(timer)

			this.playing = false

			if (code === 0 && restarted && !this.starting) {
				await Bun.sleep(5000)
				this.play(name, restarted)
			}
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
