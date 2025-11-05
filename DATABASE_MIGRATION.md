# Migração do Banco de Dados para Supabase

## Visão Geral

Este documento descreve o processo de migração completa do banco de dados PostgreSQL local para o Supabase.

## Scripts Disponíveis

### 1. `test-db-connection.ts`
**Propósito:** Testar a conexão com o banco de dados Supabase.

**Como usar:**
```bash
tsx test-db-connection.ts
```

**Requer:** Variável de ambiente `SUPABASE_DATABASE_URL`

### 2. `migrate-to-supabase.ts`
**Propósito:** Migração completa do banco de dados (schema + dados).

**Etapas executadas:**
1. **Exportação**: Exporta todos os dados do banco atual (DATABASE_URL)
2. **Schema**: Cria todas as tabelas, enums, índices e constraints no Supabase
3. **Importação**: Importa todos os dados para o Supabase
4. **Verificação**: Valida a integridade da migração

**Como usar:**
```bash
tsx migrate-to-supabase.ts
```

**Requer:** 
- `DATABASE_URL` (banco de origem)
- `SUPABASE_DATABASE_URL` (banco de destino)

### 3. `verify-supabase-db.ts`
**Propósito:** Verificação detalhada do banco Supabase.

**Informações verificadas:**
- Enums criados
- Tabelas e contagem de registros
- Índices criados
- Foreign keys configuradas
- Amostra de dados

**Como usar:**
```bash
tsx verify-supabase-db.ts
```

**Requer:** Variável de ambiente `SUPABASE_DATABASE_URL`

## Variáveis de Ambiente Necessárias

### `DATABASE_URL`
URL de conexão do banco de dados atual (Replit/Neon).
```
Já configurada automaticamente pelo Replit
```

### `SUPABASE_DATABASE_URL`
URL de conexão do banco de dados Supabase.

**Formato:**
```
postgresql://[usuário]:[senha]@[host]:[porta]/[database]?sslmode=require
```

**Exemplo:**
```
postgresql://postgres.abc123:senha@aws-1-sa-east-1.pooler.supabase.com:6543/postgres
```

## Estrutura do Banco Migrado

### Tabelas (13)
- `users` - Usuários do sistema
- `system_settings` - Configurações do sistema
- `leads` - Leads/clientes
- `conversations` - Conversas ativas
- `messages` - Histórico de mensagens
- `chatbot_states` - Estados do chatbot
- `documents` - Documentos anexados
- `vehicles` - Veículos
- `quotes` - Cotações de seguro
- `audit_logs` - Logs de auditoria
- `workflow_templates` - Templates de workflow
- `workflow_versions` - Versões dos workflows
- `workflow_transitions` - Transições de estado

### Enums (9 personalizados)
- `lead_status`
- `priority`
- `conversation_status`
- `document_type`
- `vehicle_use`
- `workflow_status`
- `parking_type`
- `gate_type`
- `insurance_type`

### Índices
32 índices criados para otimização de queries.

### Foreign Keys
7 relacionamentos configurados para manter integridade referencial.

## Resultado da Última Migração

✅ **Migração bem-sucedida em:** 2025-11-05

**Resumo:**
- 128 registros migrados
- 32 índices criados
- 7 foreign keys configuradas
- 21 enums criados (9 personalizados + 12 do Supabase)
- 13 tabelas criadas

**Detalhamento por tabela:**
- system_settings: 1 registro
- leads: 3 registros
- conversations: 3 registros
- messages: 18 registros
- chatbot_states: 3 registros
- audit_logs: 27 registros
- workflow_templates: 33 registros
- workflow_versions: 40 registros

## Segurança

### ⚠️ Importante
- **NUNCA** coloque credenciais diretamente no código
- Use sempre variáveis de ambiente (Replit Secrets)
- Após qualquer exposição de credenciais, **SEMPRE** rotacione as senhas

### Rotação de Senha Supabase

Se as credenciais foram expostas:

1. Acesse o painel do Supabase (https://app.supabase.com)
2. Navegue até o seu projeto
3. Vá em **Settings** > **Database**
4. Clique em **Reset database password**
5. Gere uma nova senha forte
6. Atualize a variável `SUPABASE_DATABASE_URL` no Replit Secrets
7. Reinicie os workflows

## Troubleshooting

### Erro: "DATABASE_URL must be set"
**Solução:** Certifique-se que a variável de ambiente está configurada nos Replit Secrets.

### Erro: "connection refused"
**Solução:** 
- Verifique se o IP do Replit está na whitelist do Supabase
- Confirme que a URL de conexão está correta
- Verifique se o banco Supabase está ativo

### Erro: "SSL required"
**Solução:** Adicione `?sslmode=require` no final da URL de conexão.

### Erros de Foreign Key durante importação
**Solução:** O script já ordena as tabelas corretamente. Se persistir, verifique se os dados estão consistentes no banco de origem.

## Notas Técnicas

### Conversão de Nomes
O script converte automaticamente nomes de colunas de `camelCase` para `snake_case` durante a importação, pois:
- O Drizzle ORM exporta em camelCase
- O PostgreSQL usa convenção snake_case

### SSL/TLS
A conexão com o Supabase usa SSL com `rejectUnauthorized: false` para compatibilidade com certificados auto-assinados do pooler.

### Performance
- A migração processa registro por registro para máxima compatibilidade
- Para volumes muito grandes (>100k registros), considere usar COPY ou batch inserts

## Próximos Passos

Após a migração bem-sucedida:

1. ✅ Verificar os dados no Supabase Dashboard
2. ✅ Testar queries básicas
3. ⚠️ **ROTACIONAR a senha do Supabase** (se ainda não foi feito)
4. 📝 Atualizar aplicação para usar `SUPABASE_DATABASE_URL` se necessário
5. 🧪 Testar a aplicação com o novo banco
6. 🗑️ Limpar/arquivar banco antigo quando estiver 100% confiante

## Suporte

Para problemas específicos do Supabase, consulte:
- https://supabase.com/docs
- https://supabase.com/docs/guides/database

Para problemas com Drizzle ORM:
- https://orm.drizzle.team/docs/overview
