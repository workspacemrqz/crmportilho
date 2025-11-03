// Script to configure webhook in WAHA

const WAHA_API = process.env.WAHA_API || 'https://waha.evolutiaoficial.com';
const WAHA_API_KEY = process.env.WAHA_API_KEY || 'ce47b12436b7b1f61490eaf59dbb61f3';
const WAHA_INSTANCIA = process.env.WAHA_INSTANCIA || 'ChatwootApi';
const WEBHOOK_URL = process.env.REPLIT_DOMAINS ? 
  `https://${process.env.REPLIT_DOMAINS}/api/webhook/waha` : 
  'http://localhost:5000/api/webhook/waha';

async function setupWebhook() {
  try {
    console.log('🔧 Configurando webhook do WAHA...');
    console.log('📍 WAHA API:', WAHA_API);
    console.log('🔑 Session:', WAHA_INSTANCIA);
    console.log('🔗 Webhook URL:', WEBHOOK_URL);

    // Configurar webhook no WAHA
    const response = await fetch(`${WAHA_API}/api/${WAHA_INSTANCIA}/config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': WAHA_API_KEY
      },
      body: JSON.stringify({
        webhooks: [
          {
            url: WEBHOOK_URL,
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
      const altResponse = await fetch(`${WAHA_API}/api/sessions/${WAHA_INSTANCIA}/webhooks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Key': WAHA_API_KEY
        },
        body: JSON.stringify({
          url: WEBHOOK_URL,
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
    const checkResponse = await fetch(`${WAHA_API}/api/sessions/${WAHA_INSTANCIA}`, {
      headers: {
        'X-Api-Key': WAHA_API_KEY
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