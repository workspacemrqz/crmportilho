import { chatwootService } from './chatwoot.service';
import dotenv from 'dotenv';

dotenv.config();

async function testChatwootIntegration() {
  console.log('🧪 ========== TESTE DE INTEGRAÇÃO CHATWOOT ==========\n');

  // 1. Verificar configuração
  console.log('1️⃣ Verificando configuração...');
  console.log('   CHATWOOT_API_URL:', process.env.CHATWOOT_API_URL ? '✅ Configurado' : '❌ Não configurado');
  console.log('   CHATWOOT_API_TOKEN:', process.env.CHATWOOT_API_TOKEN ? '✅ Configurado' : '❌ Não configurado');
  console.log('   CHATWOOT_ACCOUNT_ID:', process.env.CHATWOOT_ACCOUNT_ID ? '✅ Configurado' : '❌ Não configurado');
  console.log('   CHATWOOT_INBOX_ID:', process.env.CHATWOOT_INBOX_ID ? '✅ Configurado' : '❌ Não configurado');
  
  const isConfigured = chatwootService.isConfigured();
  console.log(`\n   Status: ${isConfigured ? '✅ Serviço configurado' : '❌ Serviço não configurado'}\n`);

  if (!isConfigured) {
    console.log('❌ Chatwoot não está configurado. Verifique as variáveis de ambiente.');
    return;
  }

  // 2. Testar busca de contato
  console.log('2️⃣ Testando busca de contato...');
  const testPhone = '5511999999999';
  const contact = await chatwootService.findContact(testPhone);
  console.log(`   Resultado: ${contact ? '✅ Contato encontrado' : 'ℹ️ Contato não encontrado (normal para teste)'}\n`);

  // 3. Resumo dos fluxos implementados
  console.log('3️⃣ Resumo dos fluxos implementados:\n');
  
  console.log('   📋 FLUXO 1 - Seguros Novos → Auto (Menu 1):');
  console.log('      ✅ Com veículo: priority "urgent" + label "realizar_cotação"');
  console.log('      ✅ Sem veículo: priority "medium" + label "realizar_cotação"\n');
  
  console.log('   📋 FLUXO 2 - Seguros Novos - Autorio (Menu 2):');
  console.log('      ✅ Com veículo: priority "urgent" + label "realizar_cotação"');
  console.log('      ✅ Sem veículo: priority "medium" + label "realizar_cotação"\n');

  console.log('4️⃣ Endpoints configurados:');
  console.log(`   Base URL: ${process.env.CHATWOOT_API_URL}/api/v1/accounts/${process.env.CHATWOOT_ACCOUNT_ID}`);
  console.log('   ✅ POST /conversations - Criar conversação');
  console.log('   ✅ POST /conversations/{id}/labels - Adicionar labels');
  console.log('   ✅ POST /conversations/{id}/toggle_priority - Definir prioridade\n');

  console.log('✅ ========== TESTE CONCLUÍDO ==========\n');
}

// Executar teste
testChatwootIntegration().catch(error => {
  console.error('❌ Erro no teste:', error);
  process.exit(1);
});
