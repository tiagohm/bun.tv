declare module 'bun' {
	interface Env {
		FFPLAY?: string
		IPTV_URL: string
		IPTV_OUTPUT_TYPE: 'mpegts' | 'hls'
	}
}
