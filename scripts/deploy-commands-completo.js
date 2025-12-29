const { REST, Routes, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
require('dotenv').config();

// Carregar comandos dos arquivos
const adminCommand = require('../src/commands/admin');
const farmCommand = require('../src/commands/farm');
const encomendaCommand = require('../src/commands/encomenda');
const registrosCommand = require('../src/commands/registros'); // NOVO: comando de registros

const commands = [
    adminCommand.data.toJSON(),
    farmCommand.data.toJSON(),
    encomendaCommand.data.toJSON(),
    registrosCommand.data.toJSON() // NOVO: adicionar comando de registros
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
        
        // Registrar no servidor específico
        console.log('\n1. 📍 Registrando comandos no servidor...');
        const guildData = await rest.put(
            Routes.applicationGuildCommands(
                process.env.CLIENT_ID,
                process.env.GUILD_ID
            ),
            { body: commands }
        );
        
        console.log(`✅ ${guildData.length} comandos registrados no servidor!`);
        
        // Tentar registrar globalmente também (opcional)
        console.log('\n2. 🌐 Registrando comandos globalmente...');
        try {
            const globalData = await rest.put(
                Routes.applicationCommands(process.env.CLIENT_ID),
                { body: commands }
            );
            console.log(`✅ ${globalData.length} comandos registrados globalmente!`);
        } catch (globalError) {
            console.log('⚠️  Não foi possível registrar globalmente (pode ser normal):', globalError.message);
        }
        
        console.log('\n🎉 Comandos registrados com sucesso!');
        console.log('\n💡 Comandos disponíveis:');
        console.log('   /fecharpastas - Fechar todas as pastas farms e gerar resumo semanal');
        console.log('   /resumofarm - Ver resumo de farm semanal');
        console.log('   /encomenda - Gerenciar sistema de encomendas');
        console.log('   /registros - Gerenciar logs de registro de membros');
        console.log('\n💡 Agora no Discord:');
        console.log('   1. Digite "/" para ver os comandos');
        console.log('   2. Aguarde alguns segundos se não aparecer');
        console.log('   3. Reinicie o Discord se necessário');
        
    } catch (error) {
        console.error('\n❌ ERRO AO REGISTRAR COMANDOS:');
        console.error('Mensagem:', error.message);
        
        if (error.code === 50001) {
            console.error('\n🔑 ERRO: Missing Access');
            console.error('O bot não tem permissão no servidor!');
            console.error('\n🔧 SOLUÇÃO:');
            console.error('1. Vá ao Discord Developer Portal');
            console.error('2. Selecione seu aplicativo');
            console.error('3. Vá em OAuth2 > URL Generator');
            console.error('4. Selecione: bot + applications.commands');
            console.error('5. Selecione permissões necessárias');
            console.error('6. Use o link gerado para readicionar o bot ao servidor');
        } else if (error.code === 50013) {
            console.error('\n🔑 ERRO: Missing Permissions');
            console.error('O bot não tem permissões suficientes!');
            console.error('\n🔧 Dê permissão de Administrador ao bot temporariamente.');
        } else if (error.rawError) {
            console.error('Detalhes:', JSON.stringify(error.rawError, null, 2));
        }
        
        process.exit(1);
    }
})();