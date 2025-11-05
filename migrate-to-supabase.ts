import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './shared/schema';
import { sql } from 'drizzle-orm';
import * as fs from 'fs';

// URLs dos bancos de dados
const CURRENT_DB_URL = process.env.DATABASE_URL;
const SUPABASE_DB_URL = process.env.SUPABASE_DATABASE_URL;

if (!CURRENT_DB_URL) {
  console.error('❌ Erro: A variável de ambiente DATABASE_URL não está configurada.');
  process.exit(1);
}

if (!SUPABASE_DB_URL) {
  console.error('❌ Erro: A variável de ambiente SUPABASE_DATABASE_URL não está configurada.');
  process.exit(1);
}

interface TableData {
  tableName: string;
  data: any[];
}

async function exportData() {
  console.log('📦 ETAPA 1: Exportando dados do banco atual...\n');
  
  const pool = new Pool({ connectionString: CURRENT_DB_URL });
  const db = drizzle(pool, { schema });

  try {
    const client = await pool.connect();
    
    // Lista de tabelas na ordem correta (respeita foreign keys)
    const tables = [
      'users',
      'system_settings',
      'leads',
      'conversations',
      'messages',
      'chatbot_states',
      'documents',
      'vehicles',
      'quotes',
      'audit_logs',
      'workflow_templates',
      'workflow_versions',
      'workflow_transitions'
    ];

    const exportedData: TableData[] = [];

    for (const tableName of tables) {
      console.log(`  📊 Exportando tabela: ${tableName}...`);
      const result = await client.query(`SELECT * FROM ${tableName}`);
      exportedData.push({
        tableName,
        data: result.rows
      });
      console.log(`     ✅ ${result.rows.length} registros exportados`);
    }

    client.release();
    await pool.end();

    // Salvar dados exportados em arquivo JSON
    fs.writeFileSync('db-export.json', JSON.stringify(exportedData, null, 2));
    console.log('\n✅ Exportação concluída! Dados salvos em db-export.json\n');

    return exportedData;
  } catch (error) {
    console.error('❌ Erro na exportação:', error);
    await pool.end();
    throw error;
  }
}

async function applySchema() {
  console.log('🔧 ETAPA 2: Aplicando schema no banco Supabase...\n');
  
  const pool = new Pool({ 
    connectionString: SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    const client = await pool.connect();

    // Criar os enums primeiro
    console.log('  📝 Criando enums...');
    
    const enums = [
      {
        name: 'lead_status',
        values: ['novo', 'em_atendimento', 'aguardando_documentos', 'encaminhado', 'transferido_humano', 'concluido', 'cancelado']
      },
      {
        name: 'priority',
        values: ['baixa', 'normal', 'alta', 'urgente']
      },
      {
        name: 'conversation_status',
        values: ['active', 'waiting', 'closed', 'transferred']
      },
      {
        name: 'document_type',
        values: ['CNH', 'CRLV', 'nota_fiscal', 'chassi', 'apolice', 'outro']
      },
      {
        name: 'vehicle_use',
        values: ['particular', 'comercial', 'motorista_app', 'autoescola', 'locadora', 'test_drive', 'outro']
      },
      {
        name: 'workflow_status',
        values: ['draft', 'active', 'inactive', 'archived']
      },
      {
        name: 'parking_type',
        values: ['garagem', 'estacionamento', 'rua']
      },
      {
        name: 'gate_type',
        values: ['manual', 'automatico']
      },
      {
        name: 'insurance_type',
        values: ['auto', 'frota', 'residencial', 'empresarial', 'vida', 'viagem', 'rc_profissional', 'seguro_fianca', 'equipamentos', 'maquinas_agricolas']
      }
    ];

    for (const enumDef of enums) {
      try {
        await client.query(`DROP TYPE IF EXISTS ${enumDef.name} CASCADE`);
        await client.query(`CREATE TYPE ${enumDef.name} AS ENUM (${enumDef.values.map(v => `'${v}'`).join(', ')})`);
        console.log(`     ✅ Enum ${enumDef.name} criado`);
      } catch (error) {
        console.log(`     ⚠️  Enum ${enumDef.name} já existe`);
      }
    }

    // Dropar tabelas existentes (em ordem reversa para respeitar FK)
    console.log('\n  🗑️  Limpando tabelas existentes...');
    const dropTables = [
      'workflow_transitions',
      'workflow_versions',
      'workflow_templates',
      'audit_logs',
      'quotes',
      'vehicles',
      'documents',
      'chatbot_states',
      'messages',
      'conversations',
      'leads',
      'system_settings',
      'users'
    ];

    for (const table of dropTables) {
      await client.query(`DROP TABLE IF EXISTS ${table} CASCADE`);
    }

    // Criar tabelas
    console.log('\n  🏗️  Criando tabelas...');

    // Users
    await client.query(`
      CREATE TABLE users (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        username TEXT NOT NULL UNIQUE,
        password TEXT NOT NULL
      )
    `);
    console.log('     ✅ Tabela users criada');

    // System Settings
    await client.query(`
      CREATE TABLE system_settings (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        buffer_timeout_seconds INTEGER NOT NULL DEFAULT 30,
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_by TEXT
      )
    `);
    console.log('     ✅ Tabela system_settings criada');

    // Leads
    await client.query(`
      CREATE TABLE leads (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        protocol VARCHAR NOT NULL UNIQUE,
        whatsapp_name TEXT,
        name TEXT,
        cpf TEXT,
        cnpj TEXT,
        email TEXT,
        phone TEXT,
        whatsapp_phone TEXT NOT NULL,
        status lead_status NOT NULL DEFAULT 'novo',
        priority priority NOT NULL DEFAULT 'normal',
        tags TEXT[] DEFAULT ARRAY[]::TEXT[],
        birth_date TIMESTAMP,
        marital_status TEXT,
        profession TEXT,
        address TEXT,
        cep TEXT,
        is_principal_driver BOOLEAN,
        driver_name TEXT,
        driver_cpf TEXT,
        has_driver_under_25 BOOLEAN,
        source TEXT,
        assigned_to TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    console.log('     ✅ Tabela leads criada');

    // Conversations
    await client.query(`
      CREATE TABLE conversations (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        lead_id VARCHAR NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
        protocol VARCHAR NOT NULL,
        status conversation_status NOT NULL DEFAULT 'active',
        current_menu TEXT,
        current_step TEXT,
        waiting_for TEXT,
        started_at TIMESTAMP NOT NULL DEFAULT NOW(),
        ended_at TIMESTAMP,
        last_activity TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    console.log('     ✅ Tabela conversations criada');

    // Messages
    await client.query(`
      CREATE TABLE messages (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        conversation_id VARCHAR NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        is_bot BOOLEAN NOT NULL DEFAULT FALSE,
        message_type VARCHAR(50) DEFAULT 'text',
        timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
        metadata JSONB,
        evolution_message_id TEXT,
        status VARCHAR(50) DEFAULT 'sent'
      )
    `);
    console.log('     ✅ Tabela messages criada');

    // Chatbot States
    await client.query(`
      CREATE TABLE chatbot_states (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        conversation_id VARCHAR NOT NULL UNIQUE REFERENCES conversations(id) ON DELETE CASCADE,
        current_state TEXT NOT NULL,
        context JSONB NOT NULL DEFAULT '{}'::JSONB,
        menu_selections JSONB DEFAULT '{}'::JSONB,
        collected_data JSONB DEFAULT '{}'::JSONB,
        pending_actions JSONB DEFAULT '[]'::JSONB,
        handoff_until TIMESTAMP,
        is_permanent_handoff BOOLEAN DEFAULT FALSE,
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    console.log('     ✅ Tabela chatbot_states criada');

    // Documents
    await client.query(`
      CREATE TABLE documents (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        lead_id VARCHAR NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
        filename TEXT NOT NULL,
        type document_type NOT NULL,
        url TEXT NOT NULL,
        mime_type TEXT,
        size INTEGER,
        uploaded_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    console.log('     ✅ Tabela documents criada');

    // Vehicles
    await client.query(`
      CREATE TABLE vehicles (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        lead_id VARCHAR NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
        plate VARCHAR(10),
        chassis VARCHAR(20),
        model TEXT,
        year VARCHAR(4),
        parking_type parking_type,
        gate_type gate_type,
        work_study_use TEXT,
        residence_type TEXT,
        reserve_car VARCHAR(10),
        towing BOOLEAN,
        has_driver_under_25 BOOLEAN,
        use_type vehicle_use,
        has_with_customer BOOLEAN,
        pickup_date TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    console.log('     ✅ Tabela vehicles criada');

    // Quotes
    await client.query(`
      CREATE TABLE quotes (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        lead_id VARCHAR NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
        insurance_type insurance_type NOT NULL,
        policy_received BOOLEAN DEFAULT FALSE,
        keep_policy_data BOOLEAN,
        status VARCHAR(50) DEFAULT 'em_analise',
        details JSONB,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    console.log('     ✅ Tabela quotes criada');

    // Audit Logs
    await client.query(`
      CREATE TABLE audit_logs (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        protocol VARCHAR,
        action TEXT NOT NULL,
        entity_type TEXT,
        entity_id TEXT,
        previous_data JSONB,
        new_data JSONB,
        user_id TEXT,
        timestamp TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    console.log('     ✅ Tabela audit_logs criada');

    // Workflow Templates
    await client.query(`
      CREATE TABLE workflow_templates (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        parent_id VARCHAR,
        template_key VARCHAR(100) NOT NULL UNIQUE,
        name TEXT NOT NULL,
        description TEXT,
        content TEXT NOT NULL,
        default_content TEXT NOT NULL,
        category VARCHAR(50),
        required_variables TEXT[] DEFAULT ARRAY[]::TEXT[],
        status workflow_status NOT NULL DEFAULT 'active',
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        version INTEGER NOT NULL DEFAULT 1,
        created_by TEXT,
        updated_by TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    console.log('     ✅ Tabela workflow_templates criada');

    // Workflow Versions
    await client.query(`
      CREATE TABLE workflow_versions (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        template_id VARCHAR NOT NULL REFERENCES workflow_templates(id) ON DELETE CASCADE,
        version INTEGER NOT NULL,
        content TEXT NOT NULL,
        status workflow_status NOT NULL,
        change_description TEXT,
        created_by TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    console.log('     ✅ Tabela workflow_versions criada');

    // Workflow Transitions
    await client.query(`
      CREATE TABLE workflow_transitions (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        from_state VARCHAR(100) NOT NULL,
        to_state VARCHAR(100) NOT NULL,
        trigger_template_key VARCHAR(100),
        condition TEXT,
        priority INTEGER DEFAULT 0,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        description TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    console.log('     ✅ Tabela workflow_transitions criada');

    // Criar índices
    console.log('\n  📊 Criando índices...');
    const indices = [
      'CREATE INDEX leads_phone_idx ON leads(phone)',
      'CREATE INDEX leads_protocol_idx ON leads(protocol)',
      'CREATE INDEX leads_cpf_idx ON leads(cpf)',
      'CREATE INDEX leads_status_idx ON leads(status)',
      'CREATE INDEX conversations_lead_idx ON conversations(lead_id)',
      'CREATE INDEX conversations_status_idx ON conversations(status)',
      'CREATE INDEX conversations_protocol_idx ON conversations(protocol)',
      'CREATE INDEX messages_conversation_idx ON messages(conversation_id)',
      'CREATE INDEX messages_timestamp_idx ON messages(timestamp)',
      'CREATE INDEX chatbot_states_conversation_idx ON chatbot_states(conversation_id)',
      'CREATE INDEX documents_lead_idx ON documents(lead_id)',
      'CREATE INDEX documents_type_idx ON documents(type)',
      'CREATE INDEX vehicles_lead_idx ON vehicles(lead_id)',
      'CREATE INDEX vehicles_plate_idx ON vehicles(plate)',
      'CREATE INDEX vehicles_chassis_idx ON vehicles(chassis)',
      'CREATE INDEX quotes_lead_idx ON quotes(lead_id)',
      'CREATE INDEX quotes_status_idx ON quotes(status)',
      'CREATE INDEX audit_logs_protocol_idx ON audit_logs(protocol)',
      'CREATE INDEX audit_logs_timestamp_idx ON audit_logs(timestamp)',
      'CREATE INDEX audit_logs_entity_idx ON audit_logs(entity_type, entity_id)',
      'CREATE INDEX workflow_templates_key_idx ON workflow_templates(template_key)',
      'CREATE INDEX workflow_templates_status_idx ON workflow_templates(status)',
      'CREATE INDEX workflow_templates_category_idx ON workflow_templates(category)',
      'CREATE INDEX workflow_templates_parent_idx ON workflow_templates(parent_id)',
      'CREATE INDEX workflow_versions_template_idx ON workflow_versions(template_id)',
      'CREATE INDEX workflow_versions_version_idx ON workflow_versions(template_id, version)',
      'CREATE INDEX workflow_transitions_from_idx ON workflow_transitions(from_state)',
      'CREATE INDEX workflow_transitions_to_idx ON workflow_transitions(to_state)'
    ];

    for (const indexSql of indices) {
      await client.query(indexSql);
    }
    console.log('     ✅ Índices criados');

    client.release();
    await pool.end();

    console.log('\n✅ Schema aplicado com sucesso no Supabase!\n');
  } catch (error) {
    console.error('❌ Erro ao aplicar schema:', error);
    await pool.end();
    throw error;
  }
}

// Função para converter camelCase para snake_case
function camelToSnake(str: string): string {
  return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
}

async function importData(exportedData: TableData[]) {
  console.log('📥 ETAPA 3: Importando dados para o Supabase...\n');
  
  const pool = new Pool({ 
    connectionString: SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    const client = await pool.connect();

    for (const tableData of exportedData) {
      if (tableData.data.length === 0) {
        console.log(`  ⏭️  Tabela ${tableData.tableName} está vazia, pulando...`);
        continue;
      }

      console.log(`  📊 Importando ${tableData.data.length} registros para ${tableData.tableName}...`);

      for (const row of tableData.data) {
        // Converter nomes de colunas para snake_case
        const columns = Object.keys(row).map(camelToSnake);
        const values = Object.values(row);
        const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
        
        const insertSql = `
          INSERT INTO ${tableData.tableName} (${columns.join(', ')})
          VALUES (${placeholders})
        `;

        try {
          await client.query(insertSql, values);
        } catch (error: any) {
          console.error(`     ⚠️  Erro ao inserir registro em ${tableData.tableName}:`, error.message);
        }
      }

      console.log(`     ✅ Dados importados para ${tableData.tableName}`);
    }

    client.release();
    await pool.end();

    console.log('\n✅ Importação concluída!\n');
  } catch (error) {
    console.error('❌ Erro na importação:', error);
    await pool.end();
    throw error;
  }
}

async function verifyMigration() {
  console.log('🔍 ETAPA 4: Verificando migração...\n');
  
  const pool = new Pool({ 
    connectionString: SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    const client = await pool.connect();

    const tables = [
      'users',
      'system_settings',
      'leads',
      'conversations',
      'messages',
      'chatbot_states',
      'documents',
      'vehicles',
      'quotes',
      'audit_logs',
      'workflow_templates',
      'workflow_versions',
      'workflow_transitions'
    ];

    console.log('📊 Contagem de registros:\n');
    console.log('━'.repeat(60));

    for (const table of tables) {
      const result = await client.query(`SELECT COUNT(*) as count FROM ${table}`);
      const count = result.rows[0].count;
      console.log(`  ${table.padEnd(30)} ${count.padStart(10)} registros`);
    }

    console.log('━'.repeat(60));

    client.release();
    await pool.end();

    console.log('\n✅ Verificação concluída!\n');
  } catch (error) {
    console.error('❌ Erro na verificação:', error);
    await pool.end();
    throw error;
  }
}

async function main() {
  console.log('🚀 INICIANDO MIGRAÇÃO COMPLETA DO BANCO DE DADOS\n');
  console.log('━'.repeat(60));
  console.log(`Origem:  DATABASE_URL (ambiente)`);
  console.log(`Destino: Supabase (aws-1-sa-east-1)`);
  console.log('━'.repeat(60));
  console.log('');

  try {
    // Etapa 1: Exportar dados
    const exportedData = await exportData();

    // Etapa 2: Aplicar schema
    await applySchema();

    // Etapa 3: Importar dados
    await importData(exportedData);

    // Etapa 4: Verificar migração
    await verifyMigration();

    console.log('🎉 MIGRAÇÃO CONCLUÍDA COM SUCESSO!\n');
    console.log('O banco de dados Supabase está configurado e pronto para uso.');
    console.log('Todos os dados foram migrados com sucesso.\n');

  } catch (error) {
    console.error('\n❌ FALHA NA MIGRAÇÃO:', error);
    process.exit(1);
  }
}

main();
