const { REST, Routes } = require('discord.js');
require('dotenv').config();

// Carregar comandos dos arquivos (removendo registros.js que não existe)
const adminCommand = require('../src/commands/admin');
const farmCommand = require('../src/commands/farm');
const encomendaCommand = require('../src/commands/encomenda');

// Apenas comandos que existem
const commands = [
    adminCommand.data.toJSON(),
    farmCommand.data.toJSON(),
    encomendaCommand.data.toJSON()
    // Removido: registrosCommand.data.toJSON()
];

console.log('📋 Comandos a serem registrados:');
commands.forEach(cmd => {
    console.log(`   /${cmd.name} - ${cmd.description}`);
});

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
    try {
        console.log('\n🔄 Iniciando registro de comandos...');
        
        if (!process.env.CLIENT_ID) {
            throw new Error('CLIENT_ID não definido no .env');
        }
        
        if (!process.env.GUILD_ID) {
            throw new Error('GUILD_ID não definido no .env');
        }
        
        console.log(`🔧 Client ID: ${process.env.CLIENT_ID}`);
        console.log(`🏠 Guild ID: ${process.env.GUILD_ID}`);
        
        // Registrar comandos APENAS no servidor específico
        console.log('\n📍 Registrando comandos no servidor...');
        const guildData = await rest.put(
            Routes.applicationGuildCommands(
                process.env.CLIENT_ID,
                process.env.GUILD_ID
            ),
            { body: commands }
        );
        
        console.log(`✅ ${guildData.length} comandos registrados no servidor!`);
        
        console.log('\n🎉 Comandos registrados com sucesso!');
        console.log('\n💡 Comandos disponíveis:');
        console.log('   /fecharpastas - Fechar todas as pastas farms e gerar resumo semanal');
        console.log('   /resumofarm - Ver resumo de farm semanal');
        console.log('   /encomenda - Gerenciar sistema de encomendas');
        console.log('   ⚠️ NOTA: Alguns comandos requerem cargo de gerência para uso');
        
        console.log('\n🔧 Para limpar comandos antigos:');
        console.log('   node scripts/clear-commands.js');
        console.log('\n🔍 Para verificar comandos:');
        console.log('   node scripts/check-commands.js');
        
    } catch (error) {
        console.error('\n❌ ERRO AO REGISTRAR COMANDOS:');
        console.error('Mensagem:', error.message);
        
        if (error.code === 50001) {
            console.error('\n🔑 ERRO: Missing Access');
            console.error('O bot não tem permissão no servidor!');
        } else if (error.code === 50013) {
            console.error('\n🔑 ERRO: Missing Permissions');
            console.error('O bot não tem permissões suficientes!');
        }
        
        console.error('\n🔧 Dê permissão de Administrador ao bot temporariamente ou use o OAuth2 URL Generator.');
        process.exit(1);
    }
})();