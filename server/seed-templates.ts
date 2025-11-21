import { storage } from './storage';

const MENSAGEM1_CONTENT = `A Prevline Seguros, agradece o contato. 

✅Trabalhamos com 15 Melhores Seguradoras.Ex: Porto Seguro, Azul, Allianz, HDI,Bradesco, etc.

⚠Seguro é perfil de cliente não conseguimos dar preço sem análise de questionário de risco.

👨‍👩‍👧‍👦 Nossa equipe é referência há mais de 15 anos.Consulte nossa avaliação no Google.

🚨 IMPORTANTE 🚨
📌 Gentileza enviar sua solicitação por escrito.
❗ Não ouvimos áudio no WhatsApp! 🔇
❌ Não atendemos ligações pelo WhatsApp!

Vamos começar seu atendimento. 😀`;

const MENSAGEM2_CONTENT = `Oi, Gabriel! Tudo ótimo por aqui, e com você? Sou o IAGO, assistente do Daniel na Prevline Seguros. Você já é cliente da Prevline ou deseja fazer uma nova cotação?`;

async function seedTemplates() {
  console.log('🌱 Iniciando seed dos templates de mensagem...\n');

  try {
    // Check and create MENSAGEM1
    console.log('📋 Verificando template MENSAGEM1...');
    const mensagem1 = await storage.getWorkflowByKey('MENSAGEM1');
    
    if (mensagem1) {
      console.log('✅ Template MENSAGEM1 já existe no banco de dados');
      console.log(`   ID: ${mensagem1.id}`);
      console.log(`   Status: ${mensagem1.status}`);
      console.log(`   Ativo: ${mensagem1.isActive}`);
      console.log(`   Versão: ${mensagem1.version}\n`);
    } else {
      console.log('❌ Template MENSAGEM1 não encontrado. Criando...');
      const created1 = await storage.createWorkflowTemplate({
        templateKey: 'MENSAGEM1',
        name: 'Mensagem de Boas-Vindas 1',
        description: 'Primeira mensagem automática de boas-vindas enviada aos novos contatos',
        content: MENSAGEM1_CONTENT,
        defaultContent: MENSAGEM1_CONTENT,
        category: 'welcome',
        status: 'active',
        isActive: true,
        version: 1,
        createdBy: 'seed-script',
        updatedBy: 'seed-script'
      });
      console.log('✅ Template MENSAGEM1 criado com sucesso!');
      console.log(`   ID: ${created1.id}`);
      console.log(`   Template Key: ${created1.templateKey}\n`);
    }

    // Check and create MENSAGEM2
    console.log('📋 Verificando template MENSAGEM2...');
    const mensagem2 = await storage.getWorkflowByKey('MENSAGEM2');
    
    if (mensagem2) {
      console.log('✅ Template MENSAGEM2 já existe no banco de dados');
      console.log(`   ID: ${mensagem2.id}`);
      console.log(`   Status: ${mensagem2.status}`);
      console.log(`   Ativo: ${mensagem2.isActive}`);
      console.log(`   Versão: ${mensagem2.version}\n`);
    } else {
      console.log('❌ Template MENSAGEM2 não encontrado. Criando...');
      const created2 = await storage.createWorkflowTemplate({
        templateKey: 'MENSAGEM2',
        name: 'Mensagem de Boas-Vindas 2',
        description: 'Segunda mensagem automática de boas-vindas enviada aos novos contatos',
        content: MENSAGEM2_CONTENT,
        defaultContent: MENSAGEM2_CONTENT,
        category: 'welcome',
        status: 'active',
        isActive: true,
        version: 1,
        createdBy: 'seed-script',
        updatedBy: 'seed-script'
      });
      console.log('✅ Template MENSAGEM2 criado com sucesso!');
      console.log(`   ID: ${created2.id}`);
      console.log(`   Template Key: ${created2.templateKey}\n`);
    }

    console.log('🎉 Seed concluído com sucesso!\n');
    process.exit(0);
  } catch (error) {
    console.error('❌ Erro ao executar seed:', error);
    process.exit(1);
  }
}

seedTemplates();
