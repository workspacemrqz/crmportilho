// Script to configure webhook in WAHA using the correct API
export {};

if (!process.env.WAHA_API_KEY) {
  console.error('❌ Erro: A variável de ambiente WAHA_API_KEY não está configurada.');
  console.error('Por favor, configure a API key do WAHA nos Replit Secrets.');
  process.exit(1);
}

const WAHA_API_CONFIG = process.env.WAHA_API || 'https://waha.evolutiaoficial.com';
const WAHA_API_KEY_CONFIG = process.env.WAHA_API_KEY!;
const WAHA_INSTANCIA_CONFIG = process.env.WAHA_INSTANCIA || 'ChatwootApi';
const WEBHOOK_URL_CONFIG = process.env.WEBHOOK_URL || 'http://localhost:3000/api/webhook/waha';

async function configureWebhook() {
  try {
    console.log('🔧 Configurando webhook do WAHA...');
    console.log('📍 WAHA API:', WAHA_API_CONFIG);
    console.log('🔑 Session:', WAHA_INSTANCIA_CONFIG);
    console.log('🔗 Webhook URL:', WEBHOOK_URL_CONFIG);

    // First, check if session exists
    console.log('\n📋 Verificando sessão existente...');
    const checkResponse = await fetch(`${WAHA_API_CONFIG}/api/sessions/${WAHA_INSTANCIA_CONFIG}`, {
      headers: {
        'X-Api-Key': WAHA_API_KEY_CONFIG
      }
    });

    if (!checkResponse.ok) {
      console.error('❌ Sessão não encontrada:', await checkResponse.text());
      console.log('\nℹ️  Você precisa criar/iniciar a sessão primeiro no WAHA');
      process.exit(1);
    }

    const sessionInfo = await checkResponse.json();
    console.log('✅ Sessão encontrada:', sessionInfo.name, '- Status:', sessionInfo.status);

    // Update session with webhook configuration
    console.log('\n🔄 Atualizando configuração do webhook...');
    const updateResponse = await fetch(`${WAHA_API_CONFIG}/api/sessions/${WAHA_INSTANCIA_CONFIG}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': WAHA_API_KEY_CONFIG
      },
      body: JSON.stringify({
        name: WAHA_INSTANCIA_CONFIG,
        config: {
          webhooks: [
            {
              url: WEBHOOK_URL_CONFIG,
              events: [
                'message',
                'message.any',
                'session.status'
              ],
              customHeaders: [
                {
                  name: 'X-Api-Key',
                  value: WAHA_API_KEY_CONFIG
                }
              ],
              retries: {
                policy: 'exponential',
                delaySeconds: 2,
                attempts: 10
              }
            }
          ]
        }
      })
    });

    if (!updateResponse.ok) {
      const error = await updateResponse.text();
      console.error('❌ Erro ao atualizar webhook:', error);
      process.exit(1);
    }

    const result = await updateResponse.json();
    console.log('✅ Webhook configurado com sucesso!');
    console.log('\n📱 Configuração da sessão:', JSON.stringify(result, null, 2));

    // Verify the configuration
    console.log('\n🔍 Verificando configuração final...');
    const verifyResponse = await fetch(`${WAHA_API_CONFIG}/api/sessions/${WAHA_INSTANCIA_CONFIG}`, {
      headers: {
        'X-Api-Key': WAHA_API_KEY_CONFIG
      }
    });

    if (verifyResponse.ok) {
      const finalConfig = await verifyResponse.json();
      if (finalConfig.config?.webhooks) {
        console.log('✅ Webhooks configurados:');
        finalConfig.config.webhooks.forEach((webhook: any, index: number) => {
          console.log(`   ${index + 1}. URL: ${webhook.url}`);
          console.log(`      Eventos: ${webhook.events?.join(', ') || 'todos'}`);
        });
      } else {
        console.log('⚠️  Nenhum webhook encontrado na configuração');
      }
    }

    console.log('\n✨ Configuração concluída! O bot agora deve responder mensagens do WhatsApp.');

  } catch (error) {
    console.error('❌ Erro ao configurar webhook:', error);
    process.exit(1);
  }
}

// Execute configuration
configureWebhook();
