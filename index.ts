import Elysia from 'elysia'
import { Tv } from './tv'

const tv = new Tv()

tv.download()

const app = new Elysia({ serve: { idleTimeout: 255 } })

app.get('/', Bun.file('index.html'))
app.get('/channels', () => tv.list())
app.get('/channels/:name/play', (req) => tv.play(decodeURIComponent(req.params.name)))
app.get('/channels/download', () => tv.download(undefined, true))

app.listen({
	hostname: '0.0.0.0',
	port: 3000,
})

process.on('beforeExit', () => tv.kill())
