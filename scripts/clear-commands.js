require('dotenv').config();
const { REST, Routes } = require('discord.js');

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

async function limparComandos() {
    try {
        console.log('🗑️  Limpando todos os comandos...');
        
        // Limpar comandos do servidor
        await rest.put(
            Routes.applicationGuildCommands(
                process.env.CLIENT_ID,
                process.env.GUILD_ID
            ),
            { body: [] }
        );
        console.log('✅ Comandos do servidor limpos!');
        
        // Limpar comandos globais
        await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID),
            { body: [] }
        );
        console.log('✅ Comandos globais limpos!');
        
    } catch (error) {
        console.error('❌ Erro ao limpar comandos:', error);
    }
}

limparComandos();