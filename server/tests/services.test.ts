import 'dotenv/config'

async function testPostgres() {
  try {
    const { Pool } = await import('pg')
    const pool = new Pool({ connectionString: process.env.DATABASE_URL })
    const res = await pool.query('SELECT 1 AS ok')
    console.log('✓ PostgreSQL connection ok:', res.rows[0])
    await pool.end()
  } catch (err) {
    console.error('❌ PostgreSQL connection failed:', err)
    process.exitCode = 1
  }
}

async function testWAHA() {
  try {
    const url = process.env.WAHA_API!
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5000)
    const res = await fetch(url, { method: 'GET', signal: controller.signal })
    clearTimeout(timer)
    console.log('✓ WAHA reachable:', res.status, res.statusText)
  } catch (err) {
    console.error('❌ WAHA connectivity failed:', err)
    process.exitCode = 1
  }
}

async function testOpenAI() {
  try {
    const OpenAI = (await import('openai')).default
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    const models = await client.models.list()
    console.log('✓ OpenAI models listed:', models.data?.length ?? 0)
  } catch (err) {
    console.error('❌ OpenAI connectivity failed:', err)
    process.exitCode = 1
  }
}

await testPostgres()
await testWAHA()
await testOpenAI()

