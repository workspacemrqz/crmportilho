import 'dotenv/config'
import net from 'net'

function checkPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => {
      server.close(() => resolve(true))
    })
    server.listen(port, '0.0.0.0')
  })
}

(async () => {
  const ok3000 = await checkPort(3000)
  const ok5000 = await checkPort(5000)

  if (!ok3000) {
    console.error('❌ Porta 3000 indisponível')
    process.exitCode = 1
  } else {
    console.log('✓ Porta 3000 disponível')
  }

  if (!ok5000) {
    console.error('❌ Porta 5000 indisponível')
    process.exitCode = 1
  } else {
    console.log('✓ Porta 5000 disponível')
  }
})()

