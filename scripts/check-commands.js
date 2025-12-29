require('dotenv').config();
const { REST, Routes } = require('discord.js');

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

async function verificarComandos() {
    try {
        console.log('🔍 Verificando comandos registrados...');
        
        const commands = await rest.get(
            Routes.applicationGuildCommands(
                process.env.CLIENT_ID,
                process.env.GUILD_ID
            )
        );
        
        console.log(`✅ Comandos registrados no servidor: ${commands.length}`);
        
        if (commands.length === 0) {
            console.log('❌ Nenhum comando encontrado!');
        } else {
            console.log('\n📋 Lista de comandos:');
            commands.forEach((cmd, index) => {
                console.log(`${index + 1}. /${cmd.name} - ${cmd.description}`);
            });
        }
        
        // Verificar comandos globalmente também
        console.log('\n🌐 Verificando comandos globais...');
        const globalCommands = await rest.get(
            Routes.applicationCommands(process.env.CLIENT_ID)
        );
        
        console.log(`Comandos globais: ${globalCommands.length}`);
        
    } catch (error) {
        console.error('❌ Erro ao verificar comandos:', error);
    }
}

verificarComandos();