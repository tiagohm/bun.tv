import Elysia from 'elysia'
import indexHtml from './index.html'
import { Tv } from './tv'

const tv = new Tv()

tv.load()

const app = new Elysia({ serve: { idleTimeout: 255 } })

app.get('/', indexHtml)
app.get('/channels', () => tv.list())
app.get('/channels/:name/play', (req) => tv.play(decodeURIComponent(req.params.name)))
app.get('/channels/download', () => tv.download(undefined, true))

app.listen({
	hostname: '0.0.0.0',
	port: 3000,
})

process.on('beforeExit', () => tv.kill())
