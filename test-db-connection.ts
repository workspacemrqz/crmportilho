import pg from 'pg';

const { Pool } = pg;

// URL de conexão do Supabase (carregada de variável de ambiente)
const SUPABASE_URL = process.env.SUPABASE_DATABASE_URL;

if (!SUPABASE_URL) {
  console.error('❌ Erro: A variável de ambiente SUPABASE_DATABASE_URL não está configurada.');
  console.error('Por favor, configure a URL de conexão do Supabase.');
  process.exit(1);
}

async function testConnection() {
  console.log('🔍 Testando conexão com o banco de dados Supabase...\n');
  
  const pool = new Pool({
    connectionString: SUPABASE_URL,
    ssl: {
      rejectUnauthorized: false // Necessário para conexões Supabase
    },
    max: 1,
    connectionTimeoutMillis: 10000,
  });

  try {
    console.log('⏳ Conectando...');
    const client = await pool.connect();
    
    console.log('✅ Conexão estabelecida com sucesso!\n');
    
    // Testar uma query simples
    console.log('📊 Executando query de teste...');
    const result = await client.query('SELECT version(), current_database(), current_user, now()');
    
    console.log('\n📋 Informações do Banco de Dados:');
    console.log('━'.repeat(60));
    console.log(`Versão PostgreSQL: ${result.rows[0].version}`);
    console.log(`Database: ${result.rows[0].current_database}`);
    console.log(`Usuário: ${result.rows[0].current_user}`);
    console.log(`Data/Hora do Servidor: ${result.rows[0].now}`);
    console.log('━'.repeat(60));
    
    // Listar tabelas existentes
    console.log('\n📁 Tabelas no banco de dados:');
    const tablesResult = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);
    
    if (tablesResult.rows.length > 0) {
      tablesResult.rows.forEach((row, index) => {
        console.log(`  ${index + 1}. ${row.table_name}`);
      });
    } else {
      console.log('  (Nenhuma tabela encontrada no schema public)');
    }
    
    client.release();
    console.log('\n✅ Teste de conexão concluído com sucesso!');
    
  } catch (error) {
    console.error('\n❌ Erro ao conectar com o banco de dados:');
    console.error('━'.repeat(60));
    if (error instanceof Error) {
      console.error('Mensagem:', error.message);
      console.error('Detalhes:', error.stack);
    } else {
      console.error(error);
    }
    console.error('━'.repeat(60));
    process.exit(1);
  } finally {
    await pool.end();
  }
}

testConnection();
