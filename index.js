require('dotenv').config();
const { Client, GatewayIntentBits, Collection, REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');

// Importar Supabase
const supabase = require('./src/database/supabase');

// Adicionar Express para health check
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// Health check endpoint
app.get('/', (req, res) => {
    res.status(200).json({ 
        status: 'online', 
        bot: 'Bot de Facção Discord',
        timestamp: new Date().toISOString()
    });
});

// Inicializar cliente Discord
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,  // IMPORTANTE: Para gerenciar membros
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.DirectMessages
    ],
    partials: ['CHANNEL', 'MESSAGE', 'REACTION', 'GUILD_MEMBER']
});

// Coleções para comandos
client.commands = new Collection();
client.cooldowns = new Collection();

// Variáveis de controle
let isInitialized = false;
let isReadyEventRegistered = false;

console.log('🚀 Iniciando bot para Railway...');

// Testar conexão com Supabase
async function testarSupabase() {
    console.log('🔗 Testando conexão com Supabase...');
    try {
        const supabase = require('./src/database/supabase');
        
        // Verificar se supabase é uma função válida
        if (typeof supabase.from !== 'function') {
            console.error('❌ Erro: supabase não foi inicializado corretamente');
            console.log('⚠️ Verifique as credenciais SUPABASE_URL e SUPABASE_KEY');
            return;
        }
        
        const { data, error } = await supabase
            .from('membros')
            .select('count', { count: 'exact', head: true });
        
        if (error) {
            console.error('❌ Erro no Supabase:', error.message);
            console.log('⚠️ O bot continuará, mas funcionalidades de banco podem não funcionar.');
        } else {
            console.log('✅ Supabase conectado com sucesso!');
        }
    } catch (error) {
        console.error('❌ Falha ao testar Supabase:', error.message);
        console.log('⚠️ Verifique as variáveis de ambiente no Railway');
    }
}

// Função para inicializar menus - CHAMADA APENAS UMA VEZ
async function inicializarMenus(client) {
    if (isInitialized) {
        console.log('⚠️ Menus já inicializados anteriormente, pulando...');
        return;
    }
    
    isInitialized = true;
    
    try {
        console.log('🎯 Inicializando menus do sistema...');
        
        // Importar funções DINAMICAMENTE para evitar cache
        delete require.cache[require.resolve('./src/components/encomendas')];
        const { enviarMenuEncomendas } = require('./src/components/encomendas');
        
        // Canal de encomendas
        const canalEncomendasId = process.env.CANAL_ENCOMENDAS_ID;
        if (canalEncomendasId) {
            try {
                const canalEncomendas = await client.channels.fetch(canalEncomendasId);
                if (canalEncomendas) {
                    // Limpar mensagens antigas do bot
                    const messages = await canalEncomendas.messages.fetch({ limit: 10 });
                    for (const [id, message] of messages) {
                        if (message.author.id === client.user.id) {
                            try {
                                await message.delete();
                            } catch (error) {
                                // Ignorar erros de deleção
                            }
                        }
                    }
                    
                    // Aguardar um pouco
                    await new Promise(resolve => setTimeout(resolve, 500));
                    
                    // Enviar novo menu
                    await enviarMenuEncomendas(canalEncomendas);
                    console.log('✅ Menu de encomendas inicializado!');
                }
            } catch (error) {
                console.error('❌ Erro ao inicializar canal de encomendas:', error.message);
            }
        }
        
        // Verificar canais de logs (apenas verificação, sem inicialização)
        const canalLogRegistroId = process.env.CANAL_LOG_REGISTRO_ID;
        const canalLogEncomendasId = process.env.CANAL_LOG_ENCOMENDAS_ID;
        
        if (canalLogRegistroId) {
            const canal = await client.channels.fetch(canalLogRegistroId).catch(() => null);
            if (canal) {
                console.log(`✅ Canal de logs de registros verificado: ${canal.name}`);
            }
        }
        
        if (canalLogEncomendasId) {
            const canal = await client.channels.fetch(canalLogEncomendasId).catch(() => null);
            if (canal) {
                console.log(`✅ Canal de logs de encomendas verificado: ${canal.name}`);
            }
        }
        
        console.log('✅ Todos os menus e canais inicializados com sucesso!');
        
    } catch (error) {
        console.error('❌ Erro ao inicializar menus:', error);
        isInitialized = false; // Reset para tentar novamente
    }
}

// Função para registrar slash commands
async function registrarComandos(client) {
    try {
        const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
        
        const commands = [];
        for (const [name, command] of client.commands) {
            commands.push(command.data.toJSON());
        }
        
        console.log(`🔄 Registrando ${commands.length} comandos slash...`);
        
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands }
        );
        
        console.log('✅ Comandos slash registrados com sucesso!');
    } catch (error) {
        console.error('❌ Erro ao registrar comandos:', error);
    }
}

// Carregar comandos
const commandsPath = path.join(__dirname, 'src/commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

let comandosCarregados = 0;
for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    try {
        // Limpar cache para garantir carregamento fresco
        delete require.cache[filePath];
        const command = require(filePath);
        
        if ('data' in command && 'execute' in command) {
            client.commands.set(command.data.name, command);
            console.log(`   ✅ ${command.data.name}`);
            comandosCarregados++;
        }
    } catch (error) {
        console.error(`   ❌ Erro ao carregar ${file}:`, error.message);
    }
}

console.log(`✅ ${comandosCarregados} comandos carregados\n`);

// Carregar eventos - APENAS UMA VEZ
const eventsPath = path.join(__dirname, 'src/events');
const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));

// Limpar listeners existentes para evitar duplicação
client.removeAllListeners();

let eventosCarregados = 0;
for (const file of eventFiles) {
    const filePath = path.join(eventsPath, file);
    try {
        // Limpar cache
        delete require.cache[filePath];
        const event = require(filePath);
        
        if (event.once) {
            // Verificar se já tem listener para este evento
            const listeners = client.listeners(event.name);
            if (listeners.length === 0) {
                client.once(event.name, (...args) => {
                    console.log(`🎯 Evento único: ${event.name}`);
                    event.execute(...args, client).catch(error => {
                        console.error(`❌ Erro no evento ${event.name}:`, error);
                    });
                });
                eventosCarregados++;
                console.log(`   ✅ ${event.name} carregado (once)`);
            } else {
                console.log(`⚠️  ${event.name} já tem listener, pulando...`);
            }
        } else {
            // Verificar se já tem listener para este evento
            const listeners = client.listeners(event.name);
            if (listeners.length === 0) {
                client.on(event.name, (...args) => {
                    event.execute(...args, client).catch(error => {
                        console.error(`❌ Erro no evento ${event.name}:`, error);
                    });
                });
                eventosCarregados++;
                console.log(`   ✅ ${event.name} carregado`);
            } else {
                console.log(`⚠️  ${event.name} já tem listener, pulando...`);
            }
        }
        
    } catch (error) {
        console.error(`   ❌ Erro ao carregar evento ${file}:`, error.message);
    }
}

console.log(`✅ ${eventosCarregados} eventos carregados\n`);

// Login do bot
console.log('🔐 Conectando ao Discord...');

// Iniciar servidor HTTP
app.listen(PORT, () => {
    console.log(`🌐 Health check rodando na porta ${PORT}`);
});

// GARANTIR QUE SÓ HÁ UM EVENTO READY
if (!isReadyEventRegistered) {
    isReadyEventRegistered = true;
    
    client.once('ready', async () => {
        console.log(`\n🤖 Bot pronto como: ${client.user.tag}`);
        console.log(`🆔 ID: ${client.user.id}`);
        console.log(`👥 Servidores: ${client.guilds.cache.size}`);
        console.log(`⚙️  Comandos disponíveis: ${client.commands.size}`);
        console.log('✨ Bot online no Railway!');
        
        // Testar Supabase
        await testarSupabase();
        
        // Aguardar 2 segundos antes de inicializar
        setTimeout(async () => {
            // Inicializar menus
            await inicializarMenus(client);
            
            // Registrar comandos slash
            await registrarComandos(client);
        }, 2000);
    });
}

// Tratamentos de erro
process.on('unhandledRejection', error => {
    console.error('❌ Erro não tratado (unhandledRejection):', error);
});

process.on('uncaughtException', error => {
    console.error('❌ Erro não capturado (uncaughtException):', error);
});

process.on('SIGTERM', () => {
    console.log('\n🛑 Recebido SIGTERM do Railway. Desconectando...');
    client.destroy();
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('\n🛑 Recebido SIGINT (Ctrl+C). Desconectando...');
    client.destroy();
    process.exit(0);
});

// Login
client.login(process.env.DISCORD_TOKEN).catch(error => {
    console.error('❌ ERRO CRÍTICO ao fazer login:', error.message);
    console.error('Verifique o token no Railway Variables');
    process.exit(1);
});