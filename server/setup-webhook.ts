// Script to configure webhook in WAHA
export {};

if (!process.env.WAHA_API_KEY) {
  console.error('❌ Erro: A variável de ambiente WAHA_API_KEY não está configurada.');
  console.error('Por favor, configure a API key do WAHA nos Replit Secrets.');
  process.exit(1);
}

const WAHA_API_SETUP = process.env.WAHA_API || 'https://waha.evolutiaoficial.com';
const WAHA_API_KEY_SETUP = process.env.WAHA_API_KEY!;
const WAHA_INSTANCIA_SETUP = process.env.WAHA_INSTANCIA || 'ChatwootApi';
const WEBHOOK_URL_SETUP = process.env.WEBHOOK_URL || 'http://localhost:5000/api/webhook/waha';

async function setupWebhook() {
  try {
    console.log('🔧 Configurando webhook do WAHA...');
    console.log('📍 WAHA API:', WAHA_API_SETUP);
    console.log('🔑 Session:', WAHA_INSTANCIA_SETUP);
    console.log('🔗 Webhook URL:', WEBHOOK_URL_SETUP);

    // Configurar webhook no WAHA
    const response = await fetch(`${WAHA_API_SETUP}/api/${WAHA_INSTANCIA_SETUP}/config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': WAHA_API_KEY_SETUP
      },
      body: JSON.stringify({
        webhooks: [
          {
            url: WEBHOOK_URL_SETUP,
            events: [
              'message',
              'message.any',
              'message.revoked',
              'message.reaction',
              'message.ack',
              'presence.update',
              'chat.archived',
              'call.received',
              'call.accepted',
              'call.rejected'
            ]
          }
        ]
      })
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('❌ Erro ao configurar webhook:', error);
      
      // Tentar método alternativo
      console.log('\n🔄 Tentando método alternativo...');
      const altResponse = await fetch(`${WAHA_API_SETUP}/api/sessions/${WAHA_INSTANCIA_SETUP}/webhooks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Key': WAHA_API_KEY_SETUP
        },
        body: JSON.stringify({
          url: WEBHOOK_URL_SETUP,
          events: ['*'] // Todos os eventos
        })
      });

      if (!altResponse.ok) {
        const altError = await altResponse.text();
        console.error('❌ Erro no método alternativo:', altError);
        throw new Error('Falha ao configurar webhook');
      }

      const altResult = await altResponse.json();
      console.log('✅ Webhook configurado com sucesso (método alternativo):', altResult);
    } else {
      const result = await response.json();
      console.log('✅ Webhook configurado com sucesso:', result);
    }

    // Verificar configuração atual
    console.log('\n📋 Verificando configuração atual...');
    const checkResponse = await fetch(`${WAHA_API_SETUP}/api/sessions/${WAHA_INSTANCIA_SETUP}`, {
      headers: {
        'X-Api-Key': WAHA_API_KEY_SETUP
      }
    });

    if (checkResponse.ok) {
      const sessionInfo = await checkResponse.json();
      console.log('📱 Informações da sessão:', sessionInfo);
    }

  } catch (error) {
    console.error('❌ Erro ao configurar webhook:', error);
    process.exit(1);
  }
}

// Executar configuração
setupWebhook();
