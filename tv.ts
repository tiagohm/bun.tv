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
							i++
						}
					}
				}
			}
		}

		console.info('📺 channels: %d', this.channels.size)
	}

	async download(url?: string, force: boolean = false) {
		let text: string | undefined

		if (force || !(await INPUT_FILE.exists()) || Date.now() - INPUT_FILE.lastModified >= INPUT_UPDATE_INTERVAL) {
			console.info('⬇️ downloading...')
			const response = await fetch(url || Bun.env.IPTV_URL)
			text = await response.text()
			await INPUT_FILE.write(text)
		}

		return this.load(text)
	}

	play(name: string) {
		const channel = this.channels.get(name)

		if (!channel) return false

		this.process?.kill()

		const commands = [Bun.env.FFPLAY || 'ffplay', '-fflags', 'nobuffer', '-flags', 'low_delay', '-framedrop', '-probesize', '1000000', '-analyzeduration', '2000000', '-hide_banner', '-fs', '-alwaysontop', '-window_title', channel.name]

		if (Bun.env.IPTV_OUTPUT_TYPE === 'hls') commands.push('-infbuf')
		commands.push(channel.url)

		this.process = Bun.spawn(commands, {
			stdout: 'ignore',
			stderr: 'inherit',
		})

		this.process.exited.then((code) => {
			console.info('exited: %d', code)
		})

		return true
	}
}
