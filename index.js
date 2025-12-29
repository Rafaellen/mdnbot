require('dotenv').config();
const { Client, GatewayIntentBits, Collection } = require('discord.js');
const fs = require('fs');
const path = require('path');

// Importar Supabase
const supabase = require('./src/database/supabase');

// Adicionar Express para health check (opcional mas recomendado)
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
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.DirectMessages
    ],
    partials: ['CHANNEL', 'MESSAGE', 'REACTION']
});

// Adicionar Supabase ao client para uso em comandos
client.supabase = supabase;

// Coleções para comandos
client.commands = new Collection();
client.cooldowns = new Collection();

console.log('🚀 Iniciando bot para Railway...');

// Testar conexão com Supabase no início
async function testarSupabase() {
    console.log('🔗 Testando conexão com Supabase...');
    try {
        const { data, error } = await supabase
            .from('membros') // Use uma tabela que existe
            .select('count', { count: 'exact', head: true });
        
        if (error) {
            console.error('❌ Erro no Supabase:', error.message);
            console.log('⚠️  O bot continuará, mas funcionalidades de banco podem não funcionar.');
        } else {
            console.log('✅ Supabase conectado com sucesso!');
        }
    } catch (error) {
        console.error('❌ Falha ao testar Supabase:', error.message);
    }
}

// Carregar comandos (seu código atual)
const commandsPath = path.join(__dirname, 'src/commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

let comandosCarregados = 0;
for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    try {
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

// Carregar eventos (seu código atual)
const eventsPath = path.join(__dirname, 'src/events');
const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));

let eventosCarregados = 0;
for (const file of eventFiles) {
    const filePath = path.join(eventsPath, file);
    try {
        const event = require(filePath);
        
        if (event.once) {
            client.once(event.name, (...args) => event.execute(...args, client));
        } else {
            client.on(event.name, (...args) => event.execute(...args, client));
        }
        eventosCarregados++;
    } catch (error) {
        console.error(`   ❌ Erro ao carregar evento ${file}:`, error.message);
    }
}

console.log(`✅ ${eventosCarregados} eventos carregados\n`);

// Login do bot
console.log('🔐 Conectando ao Discord...');

// Iniciar servidor HTTP para health check
app.listen(PORT, () => {
    console.log(`🌐 Health check rodando na porta ${PORT}`);
});

client.login(process.env.DISCORD_TOKEN)
    .then(async () => {
        console.log('✅ Login no Discord realizado com sucesso!');
        await testarSupabase();
    })
    .catch(error => {
        console.error('❌ ERRO CRÍTICO ao fazer login:', error.message);
        console.error('Verifique o token no Railway Variables');
        process.exit(1);
    });

// Seu código de eventos continua igual...
client.on('ready', () => {
    console.log(`\n🤖 Bot pronto como: ${client.user.tag}`);
    console.log(`🆔 ID: ${client.user.id}`);
    console.log(`👥 Servidores: ${client.guilds.cache.size}`);
    console.log(`⚙️  Comandos disponíveis: ${client.commands.size}`);
    console.log('✨ Bot online no Railway!');
});

// Tratamentos de erro (mantenha seu código atual)
process.on('unhandledRejection', error => {
    console.error('❌ Erro não tratado:', error);
});

process.on('SIGTERM', () => {
    console.log('\n🛑 Recebido SIGTERM do Railway. Desconectando...');
    client.destroy();
    process.exit(0);
});