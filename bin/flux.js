#!/usr/bin/env node
/**
 * Flux CLI — minimal implementation for the studio command.
 * Serves the studio static files over HTTP.
 */
import { createServer } from 'node:http'
import { createReadStream, existsSync } from 'node:fs'
import { join, extname, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.yaml': 'text/yaml',
  '.yml':  'text/yaml',
}

const [,, cmd = 'help', ...args] = process.argv

const commands = {
  studio() {
    const port = Number(args.find(a => a.startsWith('--port='))?.split('=')[1] ?? 4000)
    const studioDir = join(ROOT, 'studio')

    const server = createServer((req, res) => {
      let urlPath = req.url.split('?')[0]
      if (urlPath === '/' || urlPath === '') urlPath = '/index.html'

      const filePath = join(studioDir, urlPath)

      // Basic path traversal guard
      if (!filePath.startsWith(studioDir)) {
        res.writeHead(403)
        res.end('Forbidden')
        return
      }

      if (!existsSync(filePath)) {
        res.writeHead(404)
        res.end('Not found')
        return
      }

      const mime = MIME[extname(filePath)] ?? 'application/octet-stream'
      res.writeHead(200, { 'Content-Type': mime })
      createReadStream(filePath).pipe(res)
    })

    server.listen(port, () => {
      console.log(`Flux Studio running at http://localhost:${port}`)
      console.log('Open your browser to get started.')
      console.log('Press Ctrl+C to stop.')
    })
  },

  dev() {
    console.log('flux dev — starting studio (runtime watch not yet implemented)')
    commands.studio()
  },

  help() {
    console.log(`
Flux — message-driven reactive programming runtime

Usage:
  flux studio          Start the Scenario Builder on localhost:4000
  flux studio --port=N Use a custom port
  flux dev             Alias for studio (runtime integration coming soon)
  flux help            Show this help

Coming soon:
  flux run             Load units and start the runtime
  flux inject          Inject a message into a running runtime
  flux check           Validate unit files
  flux scenario        Run scenarios
  flux publish         Run scenarios + emit build artifact
  flux checkpoint      Save / restore / diff checkpoints
    `.trim())
  },
}

const fn = commands[cmd]
if (fn) {
  fn()
} else {
  console.error(`Unknown command: ${cmd}`)
  commands.help()
  process.exit(1)
}
