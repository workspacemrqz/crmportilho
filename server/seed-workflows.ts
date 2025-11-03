import { db } from './db';
import { workflowTemplates } from '@shared/schema';

// Default workflow messages from current chatbot implementation
const defaultWorkflows = [
  {
    templateKey: 'MENSAGEM1',
    name: 'Mensagem de Boas-vindas',
    description: 'Primeira mensagem enviada ao cliente ao iniciar conversa',
    content: `Olá! 👋 Sou [NOME_DA_IA], assistente virtual da Portilho Corretora de Seguros. 💚 
Será um prazer te atender! 
📌 Protocolo: [NÚMERO_DO_PROTOCOLO] 
📅 Data do atendimento: [DD/MM/AAAA] 
Se quiser falar com um atendente humano, é só avisar.`,
    category: 'initial',
    requiredVariables: ['[NOME_DA_IA]', '[NÚMERO_DO_PROTOCOLO]', '[DD/MM/AAAA]']
  },
  {
    templateKey: 'MENSAGEM2',
    name: 'Menu Principal',
    description: 'Menu com opções de atendimento (1-6)',
    content: `Digite o número do setor que deseja falar:

1️⃣ Seguros Novos – Geral → Solicitar nova cotação para produtos diversos
2️⃣ Seguros Novos – Autorio → Solicitar nova cotação da Autorio
3️⃣ Renovação de Seguro → Atualizar ou renovar sua apólice
4️⃣ Endosso / Alteração → Alterações na apólice
5️⃣ Parcelas, Boletos ou 2ª via → Consultar ou emitir
6️⃣ Sinistros / Assistências → Abrir sinistro, solicitar assistência`,
    category: 'menu',
    requiredVariables: []
  },
  {
    templateKey: 'MENU1_ABERTURA',
    name: 'Menu 1 - Abertura Seguros Novos',
    description: 'Primeira mensagem do fluxo de seguros novos',
    content: `Perfeito! 😄 Antes de começarmos, como você conheceu a Portilho?
💚 Será um prazer ajudar você a garantir tranquilidade e segurança.

Você deseja:
🔘 Fazer um seguro novo
🔘 Fazer cotação de um seguro de outra seguradora`,
    category: 'menu1',
    requiredVariables: []
  },
  {
    templateKey: 'MENU1_TIPO_SEGURO',
    name: 'Menu 1 - Tipo de Seguro',
    description: 'Lista de tipos de seguro disponíveis',
    content: `Agora me diga, qual tipo de seguro você deseja fazer? 
Trabalhamos com: 
🚗 Auto 
🚙 Frota 
🏠 Residencial 
🏢 Empresarial 
❤️ Vida 
✈️ Viagem 
💼 RC Profissional 
🔑 Seguro Fiança 
⚙️ Equipamentos / Máquinas Agrícolas`,
    category: 'menu1',
    requiredVariables: []
  },
  {
    templateKey: 'AUTO_ABERTURA',
    name: 'Auto - Abertura',
    description: 'Mensagem inicial do fluxo de seguro auto',
    content: `Você escolheu Auto. 🚗
💚 Será um prazer ajudar você a garantir tranquilidade e segurança.

O veículo já está com você ou quando você irá pegá-lo?`,
    category: 'auto',
    requiredVariables: []
  },
  {
    templateKey: 'AUTO_URGENTE',
    name: 'Auto - Veículo Urgente',
    description: 'Mensagem quando cliente já está com veículo sem seguro',
    content: `Entendi! 😟 Vejo que você já está utilizando o veículo sem seguro. 💚 
Não se preocupe, vamos agilizar sua cotação.`,
    category: 'auto',
    requiredVariables: []
  },
  {
    templateKey: 'AUTO_QUANDO_PEGA',
    name: 'Auto - Quando Pega Veículo',
    description: 'Pergunta sobre quando irá pegar o veículo',
    content: `Perfeito! Quando você irá pegar o veículo?`,
    category: 'auto',
    requiredVariables: []
  },
  {
    templateKey: 'AUTO_DADOS_PESSOAIS',
    name: 'Auto - Dados Pessoais',
    description: 'Solicitação de dados pessoais do segurado',
    content: `📌 Dados Pessoais do Segurado / Condutor

Por favor, informe:

1️⃣ Nome completo:
2️⃣ CPF:
3️⃣ Data de nascimento:
4️⃣ Estado civil:
5️⃣ Endereço completo:
6️⃣ CEP:
7️⃣ Telefone:
8️⃣ E-mail:
9️⃣ Profissão:

🔟 É o principal condutor do veículo?
• Sim
• Não

Se não for, informar:
• Nome do condutor:
• CPF do condutor:

⚠️ Existe condutor na faixa etária de 18 a 25 anos?
• Sim
• Não

💬 Dica: Você pode responder digitando ou enviando áudio, se for mais rápido e prático.

📄 Documentação necessária:
• CNH do principal condutor
• Nota fiscal ou chassi ou CRLV do veículo
(Se enviar chassi ou placa, confirmar modelo e ano)`,
    category: 'auto',
    requiredVariables: []
  },
  {
    templateKey: 'AUTO_DADOS_VEICULO_ESTACIONAMENTO',
    name: 'Auto - Pergunta 1: Estacionamento',
    description: 'Pergunta sobre onde o veículo fica estacionado',
    content: `Onde o veículo fica estacionado? (ex: Garagem, Estacionamento ou Rua)`,
    category: 'auto',
    requiredVariables: []
  },
  {
    templateKey: 'AUTO_DADOS_VEICULO_PORTAO',
    name: 'Auto - Pergunta 2: Portão',
    description: 'Pergunta sobre tipo de portão da garagem',
    content: `A garagem tem portão manual ou automático?`,
    category: 'auto',
    requiredVariables: []
  },
  {
    templateKey: 'AUTO_DADOS_VEICULO_TRABALHO_ESTUDO',
    name: 'Auto - Pergunta 3: Trabalho/Estudo',
    description: 'Pergunta sobre uso do veículo para trabalho/estudo',
    content: `Você usa o veículo para ir ao trabalho e/ou estudo? (ex: Trabalho, Estudo, Ambos ou Nenhum)`,
    category: 'auto',
    requiredVariables: []
  },
  {
    templateKey: 'AUTO_DADOS_VEICULO_MORADIA',
    name: 'Auto - Pergunta 4: Moradia',
    description: 'Pergunta sobre tipo de moradia',
    content: `Mora em casa ou apartamento?`,
    category: 'auto',
    requiredVariables: []
  },
  {
    templateKey: 'AUTO_DADOS_VEICULO_CARRO_RESERVA',
    name: 'Auto - Pergunta 5: Carro Reserva',
    description: 'Pergunta sobre carro reserva',
    content: `Deseja carro reserva? Se sim, por quantos dias? (ex: 7, 15, 30 dias ou Não desejo)`,
    category: 'auto',
    requiredVariables: []
  },
  {
    templateKey: 'AUTO_DADOS_VEICULO_REBOQUE',
    name: 'Auto - Pergunta 6: Reboque',
    description: 'Pergunta sobre reboque',
    content: `Deseja reboque?`,
    category: 'auto',
    requiredVariables: []
  },
  {
    templateKey: 'AUTO_DADOS_VEICULO_CONDUTOR_MENOR_25',
    name: 'Auto - Pergunta 7: Condutor Menor 25',
    description: 'Pergunta sobre condutor menor de 25 anos',
    content: `Tem algum condutor menor de 25 anos?`,
    category: 'auto',
    requiredVariables: []
  },
  {
    templateKey: 'AUTO_DADOS_VEICULO_TIPO_USO',
    name: 'Auto - Pergunta 8: Tipo de Uso',
    description: 'Pergunta sobre tipo de uso do veículo',
    content: `Qual o tipo de uso do veículo? (ex: Particular, Comercial, Motorista de app, Autoescola, Locadora, Test drive ou Outro)

⚠️ Importante: Veículos plotados com nome de empresas são considerados uso comercial. Caso o veículo esteja registrado como particular mas seja usado para fins comerciais, o sinistro poderá ser negado.`,
    category: 'auto',
    requiredVariables: []
  },
  {
    templateKey: 'MENU1_COTACAO_OUTRA_CORRETORA_1',
    name: 'Menu 1 - Cotação Outra Corretora (Passo 1)',
    description: 'Solicitação de apólice de outra seguradora',
    content: `Entendi! 😊 Para que possamos analisar e oferecer a melhor proposta, poderia, por favor, enviar a apólice atual, caso tenha?
📌 Observação: Se você não tiver a apólice, ainda podemos ajudá-lo, mas com menos detalhes iniciais.`,
    category: 'menu1',
    requiredVariables: []
  },
  {
    templateKey: 'MENU1_COTACAO_OUTRA_CORRETORA_2',
    name: 'Menu 1 - Cotação Outra Corretora (Passo 2)',
    description: 'Pergunta sobre manter dados da apólice',
    content: `Para agilizar, você deseja manter todos os dados da ficha cadastral do item segurado e das coberturas exatamente como estão na apólice enviada?
🔘 Sim, manter os dados
🔘 Não, desejo revisar ou atualizar alguns dados`,
    category: 'menu1',
    requiredVariables: []
  },
  {
    templateKey: 'MENU2_AUTORIO_STATUS',
    name: 'Menu 2 - Autorio Status do Veículo',
    description: 'Cliente escolhe opção 2 - Pergunta sobre status do veículo',
    content: `Você escolheu Seguros Novos - Autorio. 🚗

O veículo já está com você ou quando você irá pegá-lo?`,
    category: 'menu2',
    requiredVariables: []
  },
  {
    templateKey: 'MENU2_AUTORIO_URGENTE',
    name: 'Menu 2 - Autorio Cotação Urgente',
    description: 'Veículo já está com o cliente - prioridade urgente',
    content: `Entendido! Como o veículo já está com você, vou marcar sua solicitação com grau de importância ALTO e COTAÇÃO URGENTE. 🚨

Vou transferir você agora para um de nossos especialistas Autorio que dará prioridade ao seu atendimento. Um momento, por favor... 💚`,
    category: 'menu2',
    requiredVariables: []
  },
  {
    templateKey: 'MENU2_AUTORIO_QUANDO_PEGA',
    name: 'Menu 2 - Autorio Quando Pega',
    description: 'Pergunta quando o cliente vai pegar o veículo',
    content: `Entendi que você ainda não pegou o carro. Para melhor organizarmos o atendimento, quando está previsto para retirar o veículo? 

Por favor, informe a data e hora aproximadas.`,
    category: 'menu2',
    requiredVariables: []
  },
  {
    templateKey: 'MENU2_AUTORIO_PRIORIDADE_PADRAO',
    name: 'Menu 2 - Autorio Prioridade Padrão',
    description: 'Cliente ainda não pegou o veículo - prioridade padrão',
    content: `Perfeito! Anotei que você irá retirar o veículo em: [DATA_HORA]. 📅

Como ainda há tempo, defini sua solicitação com prioridade PADRÃO.

Vou transferir você agora para um de nossos especialistas Autorio que irá prosseguir com seu atendimento. Um momento, por favor... 💚`,
    category: 'menu2',
    requiredVariables: ['[DATA_HORA]']
  },
  {
    templateKey: 'MENU3_RENOVACAO_ABERTURA',
    name: 'Menu 3 - Renovação Abertura',
    description: 'Início do fluxo de renovação de seguro',
    content: `Certo! 😊
Vamos agilizar seu atendimento.
Por favor, me confirme qual tipo de seguro você tem:
🚗 Auto / Frota
🏢 Empresarial
🏠 Residencial
💚 Vida
✈️ Viagem
⚙️ Equipamentos / Máquinas agrícolas
💼 RC Profissional
🏘️ Seguro Fiança
Assim que eu souber, posso te orientar melhor.`,
    category: 'menu3',
    requiredVariables: []
  },
  {
    templateKey: 'MENU3_RENOVACAO_COLETAS',
    name: 'Menu 3 - Renovação Coletas',
    description: 'Coleta de dados para renovação',
    content: `Se escolher Auto ou Frota:
Qual é a placa do veículo?
Se escolher Empresarial:
Qual é o CNPJ da empresa?
Se escolher Vida ou Residencial:
Qual é o CPF do segurado?
Após isso, encaminharei seu atendimento para o setor responsável. 💚`,
    category: 'menu3',
    requiredVariables: []
  },
  {
    templateKey: 'MENU4_ENDOSSO_ABERTURA',
    name: 'Menu 4 - Endosso Abertura',
    description: 'Início do fluxo de endosso/alteração',
    content: `Entendi! 😊 Para dar andamento, me informe qual tipo de mudança você deseja fazer:
🔘 Alteração cadastral
🔘 Alteração de cobertura
🔘 Alteração no item segurado`,
    category: 'menu4',
    requiredVariables: []
  },
  {
    templateKey: 'MENU4_ENDOSSO_ITEM',
    name: 'Menu 4 - Endosso Item',
    description: 'Pergunta sobre qual item alterar',
    content: `Perfeito! Por favor, me informe qual item deseja alterar:
🔘 Veículo
🔘 Outros`,
    category: 'menu4',
    requiredVariables: []
  },
  {
    templateKey: 'MENU4_ENDOSSO_DOCS',
    name: 'Menu 4 - Endosso Documentos',
    description: 'Solicitação de documentos para alteração',
    content: `🔹 Para prosseguir, envie o documento necessário para a alteração:
Veículo → CRLV ou nota fiscal
Outros → nota fiscal ou documento equivalente
(Após receber o documento, a IA encaminha o atendimento para o setor responsável.) 💚`,
    category: 'menu4',
    requiredVariables: []
  },
  {
    templateKey: 'MENU5_PARCELAS_ABERTURA',
    name: 'Menu 5 - Parcelas Abertura',
    description: 'Início do fluxo de parcelas e boletos',
    content: `Entendido! Para que eu possa ajudá-lo, por favor, me confirme qual tipo de seguro você possui:
🚗 Auto / Frota
🏢 Empresarial
🏠 Residencial
💚 Vida
✈️ Viagem
⚙️ Equipamentos / Máquinas agrícolas
💼 RC Profissional
🏘️ Seguro Fiança
Assim que eu souber, posso orientar melhor sobre boletos, parcelas e 2ª via de apólices. 💚`,
    category: 'menu5',
    requiredVariables: []
  },
  {
    templateKey: 'MENU5_PARCELAS_COLETAS',
    name: 'Menu 5 - Parcelas Coletas',
    description: 'Coleta de dados para parcelas',
    content: `Se escolher Auto ou Frota:
Qual é a placa do veículo?
Se escolher Empresarial:
Qual é o CNPJ da empresa?
Se escolher Vida ou Residencial:
Qual é o CPF do segurado?
(Após receber essas informações, a IA pode encaminhar o atendimento para o setor responsável ou fornecer orientações específicas.)`,
    category: 'menu5',
    requiredVariables: []
  },
  {
    templateKey: 'MENU6_SINISTROS_ABERTURA',
    name: 'Menu 6 - Sinistros Abertura',
    description: 'Início do fluxo de sinistros',
    content: `Entendido! Para que eu possa ajudá-lo, por favor, me confirme qual tipo de seguro você possui:
🚗 Auto / Frota
🏢 Empresarial
🏠 Residencial
💚 Vida
✈️ Viagem
⚙️ Equipamentos / Máquinas agrícolas
💼 RC Profissional
🏘️ Seguro Fiança
Assim que eu souber, posso orientar melhor sobre como dar andamento ao seu sinistro. 💚`,
    category: 'menu6',
    requiredVariables: []
  },
  {
    templateKey: 'MENU6_SINISTROS_COLETAS',
    name: 'Menu 6 - Sinistros Coletas',
    description: 'Coleta de dados para sinistros',
    content: `Se escolher Auto ou Frota:
Qual é a placa do veículo?
Se escolher Empresarial:
Qual é o CNPJ da empresa?
Se escolher Vida ou Residencial:
Qual é o CPF do segurado?`,
    category: 'menu6',
    requiredVariables: []
  }
];

export async function seedWorkflows() {
  console.log('🌱 Seeding workflow templates...');
  
  try {
    for (const workflow of defaultWorkflows) {
      await db.insert(workflowTemplates).values({
        templateKey: workflow.templateKey,
        name: workflow.name,
        description: workflow.description,
        content: workflow.content,
        defaultContent: workflow.content,
        category: workflow.category,
        requiredVariables: workflow.requiredVariables,
        status: 'active',
        isActive: true,
        version: 1,
        createdBy: 'system'
      }).onConflictDoNothing();
      
      console.log(`✅ Seeded: ${workflow.templateKey}`);
    }
    
    console.log('✅ Workflow templates seeded successfully!');
  } catch (error) {
    console.error('❌ Error seeding workflows:', error);
    throw error;
  }
}

// Run seed if called directly
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  seedWorkflows()
    .then(() => {
      console.log('Done!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Failed:', error);
      process.exit(1);
    });
}
