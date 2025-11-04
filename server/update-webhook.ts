// Script para atualizar webhook no WAHA
const WAHA_API = process.env.WAHA_API || 'https://waha.evolutiaoficial.com';
const WAHA_API_KEY = process.env.WAHA_API_KEY || 'ce47b12436b7b1f61490eaf59dbb61f3';
const WAHA_INSTANCIA = process.env.WAHA_INSTANCIA || 'ChatwootApi';
const WEBHOOK_URL = process.env.WEBHOOK_URL || 'http://localhost:5000/api/webhook/waha';

async function updateWebhook() {
  console.log('🔧 Atualizando webhook do WAHA...\n');
  console.log('📍 WAHA API:', WAHA_API);
  console.log('🔑 Instância:', WAHA_INSTANCIA);
  console.log('🔗 Nova URL do Webhook:', WEBHOOK_URL);
  console.log('\n');

  try {
    // Usar PATCH para atualizar a configuração existente
    console.log('📝 Atualizando configuração do webhook...');
    
    const webhookConfig = {
      config: {
        webhooks: [
          {
            url: WEBHOOK_URL,
            events: ["message", "message.any", "message.revoked"],
            hmac: {
              key: null
            },
            retries: {
              delaySeconds: 2,
              attempts: 15,
              policy: "exponential"
            },
            customHeaders: [
              {
                name: "X-Api-Key",
                value: WAHA_API_KEY
              }
            ]
          }
        ]
      }
    };

    const updateResponse = await fetch(`${WAHA_API}/api/sessions/${WAHA_INSTANCIA}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': WAHA_API_KEY
      },
      body: JSON.stringify(webhookConfig)
    });

    if (updateResponse.ok) {
      console.log('✅ Webhook atualizado com sucesso!');
      const result = await updateResponse.json();
      console.log('\n📋 Nova configuração:', JSON.stringify(result.config.webhooks, null, 2));
    } else {
      const errorText = await updateResponse.text();
      console.log('❌ Erro ao atualizar webhook:', errorText);
      
      // Tentar método PUT
      console.log('\n🔄 Tentando método PUT...');
      const putResponse = await fetch(`${WAHA_API}/api/sessions/${WAHA_INSTANCIA}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Key': WAHA_API_KEY
        },
        body: JSON.stringify(webhookConfig)
      });

      if (putResponse.ok) {
        console.log('✅ Webhook atualizado com sucesso (método PUT)!');
        const result = await putResponse.json();
        console.log('\n📋 Nova configuração:', JSON.stringify(result.config.webhooks, null, 2));
      } else {
        console.log('❌ Erro no método PUT:', await putResponse.text());
      }
    }

    // Verificar a configuração atualizada
    console.log('\n🔍 Verificando configuração atualizada...');
    const checkResponse = await fetch(`${WAHA_API}/api/sessions/${WAHA_INSTANCIA}`, {
      headers: {
        'X-Api-Key': WAHA_API_KEY
      }
    });

    if (checkResponse.ok) {
      const sessionInfo = await checkResponse.json();
      const currentWebhook = sessionInfo.config.webhooks[0];
      
      if (currentWebhook && currentWebhook.url === WEBHOOK_URL) {
        console.log('✅ Webhook configurado corretamente!');
        console.log('📍 URL atual:', currentWebhook.url);
        console.log('📬 Eventos:', currentWebhook.events);
      } else {
        console.log('⚠️ Webhook ainda não está com a URL correta');
        console.log('📍 URL atual:', currentWebhook?.url || 'Nenhum webhook configurado');
        console.log('📍 URL esperada:', WEBHOOK_URL);
      }
    }

    console.log('\n✨ Configuração completa! Agora as mensagens do WhatsApp serão recebidas na aplicação.');
    console.log('📱 Envie uma mensagem para o número: 556299004295');

  } catch (error) {
    console.error('❌ Erro durante atualização:', error);
  }
}

// Executar atualização
updateWebhook();
