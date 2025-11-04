import 'dotenv/config'

const required = [
  'SESSION_SECRET',
  'DATABASE_URL',
  'WAHA_API',
  'WAHA_API_KEY',
  'LOGIN',
  'SENHA',
  'OPENAI_API_KEY',
]

let ok = true
for (const key of required) {
  if (!process.env[key] || process.env[key]!.length === 0) {
    console.error(`❌ Missing env: ${key}`)
    ok = false
  } else {
    console.log(`✓ ${key} loaded`)
  }
}

if (!ok) {
  console.error('Environment variables not loaded correctly.')
  process.exit(1)
} else {
  console.log('All required environment variables are present.')
}

