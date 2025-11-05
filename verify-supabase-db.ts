import { Pool } from 'pg';

const SUPABASE_DB_URL = process.env.SUPABASE_DATABASE_URL;

if (!SUPABASE_DB_URL) {
  console.error('❌ Erro: A variável de ambiente SUPABASE_DATABASE_URL não está configurada.');
  console.error('Por favor, configure a URL de conexão do Supabase.');
  process.exit(1);
}

async function verifyDatabase() {
  console.log('🔍 VERIFICAÇÃO DETALHADA DO BANCO SUPABASE\n');
  console.log('━'.repeat(60));
  
  const pool = new Pool({ 
    connectionString: SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    const client = await pool.connect();

    // 1. Verificar conexão
    console.log('✅ Conexão estabelecida com sucesso!\n');

    // 2. Verificar enums
    console.log('📝 ENUMS CRIADOS:');
    const enumsResult = await client.query(`
      SELECT t.typname as enum_name,
             string_agg(e.enumlabel, ', ' ORDER BY e.enumsortorder) as values
      FROM pg_type t
      JOIN pg_enum e ON t.oid = e.enumtypid  
      WHERE t.typtype = 'e'
      GROUP BY t.typname
      ORDER BY t.typname
    `);
    enumsResult.rows.forEach(row => {
      console.log(`  ${row.enum_name}: ${row.values}`);
    });

    // 3. Verificar tabelas
    console.log('\n📊 TABELAS E CONTAGENS:');
    const tables = [
      'users', 'system_settings', 'leads', 'conversations', 
      'messages', 'chatbot_states', 'documents', 'vehicles',
      'quotes', 'audit_logs', 'workflow_templates', 
      'workflow_versions', 'workflow_transitions'
    ];

    let totalRecords = 0;
    for (const table of tables) {
      const result = await client.query(`SELECT COUNT(*) as count FROM ${table}`);
      const count = parseInt(result.rows[0].count);
      totalRecords += count;
      const status = count > 0 ? '✅' : '⚪';
      console.log(`  ${status} ${table.padEnd(30)} ${count.toString().padStart(5)} registros`);
    }
    
    console.log(`\n  📊 Total: ${totalRecords} registros migrados`);

    // 4. Verificar índices
    console.log('\n🔍 ÍNDICES CRIADOS:');
    const indexResult = await client.query(`
      SELECT 
        tablename,
        indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
      AND indexname NOT LIKE '%_pkey'
      ORDER BY tablename, indexname
    `);
    
    const indexesByTable: { [key: string]: string[] } = {};
    indexResult.rows.forEach(row => {
      if (!indexesByTable[row.tablename]) {
        indexesByTable[row.tablename] = [];
      }
      indexesByTable[row.tablename].push(row.indexname);
    });

    let totalIndices = 0;
    Object.entries(indexesByTable).forEach(([table, indices]) => {
      console.log(`  ${table}: ${indices.length} índices`);
      totalIndices += indices.length;
    });
    console.log(`\n  📊 Total: ${totalIndices} índices criados`);

    // 5. Verificar constraints (foreign keys)
    console.log('\n🔗 FOREIGN KEYS:');
    const fkResult = await client.query(`
      SELECT 
        tc.table_name,
        kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
      ORDER BY tc.table_name
    `);
    
    const fkByTable: { [key: string]: number } = {};
    fkResult.rows.forEach(row => {
      if (!fkByTable[row.table_name]) {
        fkByTable[row.table_name] = 0;
      }
      fkByTable[row.table_name]++;
    });

    Object.entries(fkByTable).forEach(([table, count]) => {
      console.log(`  ${table}: ${count} foreign keys`);
    });
    console.log(`\n  📊 Total: ${fkResult.rows.length} foreign keys`);

    // 6. Teste de query nos dados
    console.log('\n📋 AMOSTRA DE DADOS:');
    
    // Verificar leads
    const leadsResult = await client.query('SELECT protocol, name, status FROM leads LIMIT 3');
    console.log(`\n  Leads (${leadsResult.rows.length} registros):`);
    leadsResult.rows.forEach(row => {
      console.log(`    - Protocolo: ${row.protocol}, Nome: ${row.name || 'N/A'}, Status: ${row.status}`);
    });

    // Verificar workflow templates
    const templatesResult = await client.query('SELECT template_key, name, status FROM workflow_templates LIMIT 5');
    console.log(`\n  Workflow Templates (primeiros 5 de ${templatesResult.rows.length}):`);
    templatesResult.rows.forEach(row => {
      console.log(`    - ${row.template_key}: ${row.name} (${row.status})`);
    });

    console.log('\n━'.repeat(60));
    console.log('\n✅ BANCO DE DADOS SUPABASE CONFIGURADO E FUNCIONANDO!');
    console.log('\n📊 Resumo:');
    console.log(`   - ${totalRecords} registros migrados`);
    console.log(`   - ${totalIndices} índices criados`);
    console.log(`   - ${fkResult.rows.length} foreign keys configuradas`);
    console.log(`   - ${enumsResult.rows.length} enums criados`);
    console.log(`   - ${tables.length} tabelas criadas`);
    console.log('\n');

    client.release();
    await pool.end();

  } catch (error) {
    console.error('❌ Erro na verificação:', error);
    await pool.end();
    process.exit(1);
  }
}

verifyDatabase();
