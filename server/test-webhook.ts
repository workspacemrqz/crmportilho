// Script de teste para simular webhook de mensagem de cliente
// Execute com: tsx server/test-webhook.ts

if (!process.env.WAHA_API_KEY) {
  console.error('❌ Erro: A variável de ambiente WAHA_API_KEY não está configurada.');
  console.error('Por favor, configure a API key do WAHA nos Replit Secrets.');
  process.exit(1);
}

async function testWebhookWithClientMessage() {
  const webhookPayload = {
    "event": "message.any",
    "id": "evt_test_client_message",
    "timestamp": Date.now(),
    "session": "ChatwootApi",
    "metadata": {},
    "me": {
      "id": "556299004295@c.us",
      "pushName": "Comercial Gabriel Camargo",
      "lid": "275346226188381@lid",
      "jid": "556299004295:49@s.whatsapp.net"
    },
    "payload": {
      "id": `false_5511999887766@c.us_TEST${Date.now()}`,
      "timestamp": Math.floor(Date.now() / 1000),
      "from": "5511999887766@c.us", // Número de teste do cliente
      "fromMe": false, // IMPORTANTE: mensagem DO CLIENTE, não do bot
      "body": "Olá, quero fazer um orçamento de seguro",
      "to": "556299004295@c.us",
      "participant": null,
      "hasMedia": false,
      "media": null,
      "ack": 2,
      "ackName": "RECEIVED",
      "_data": {
        "Info": {
          "Chat": "5511999887766@s.whatsapp.net",
          "Sender": "5511999887766@s.whatsapp.net",
          "IsFromMe": false,
          "PushName": "Gabriel Marquez", // Nome do cliente no WhatsApp
          "IsGroup": false
        }
      }
    }
  };

  try {
    console.log('📤 Enviando webhook de teste com mensagem de cliente...');
    console.log('📱 Número do cliente: 5511999887766');
    console.log('👤 Nome do cliente (PushName): Gabriel Marquez');
    console.log('💬 Mensagem: "Olá, quero fazer um orçamento de seguro"');
    
    const response = await fetch('http://localhost:5000/api/webhook/waha', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': process.env.WAHA_API_KEY!,
      },
      body: JSON.stringify(webhookPayload)
    });

    const result = await response.json();
    console.log('✅ Resposta do webhook:', response.status, result);
    
    if (response.ok) {
      console.log('🎉 Teste executado com sucesso!');
      console.log('📋 Verifique a página /clientes - o lead deve aparecer com:');
      console.log('   - Nome WhatsApp: Gabriel Marquez');
      console.log('   - WhatsApp: (11) 99988-7766');
    } else {
      console.log('❌ Erro no teste:', result);
    }
  } catch (error) {
    console.error('❌ Erro ao executar teste:', error);
  }
}

// Executar o teste
testWebhookWithClientMessage();