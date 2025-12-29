const { Events } = require('discord.js');
const supabase = require('../database/supabase');
const { enviarMenuRegistro, enviarMenuPastaFarm } = require('../components/registro');
const { enviarMenuEncomendas } = require('../components/encomendas');

module.exports = {
    name: Events.ClientReady,
    once: true,
    async execute(client) {
        console.log(`✅ Bot online como ${client.user.tag}`);
        
        // Inicializar menus nos canais
        try {
            const guild = await client.guilds.fetch(process.env.GUILD_ID);
            
            // Canal de registro
            const canalRegistro = await guild.channels.fetch(process.env.CANAL_REGISTRO_ID);
            await canalRegistro.bulkDelete(100); // Limpar histórico
            await enviarMenuRegistro(canalRegistro);
            
            // Canal de criação de pasta farm
            const canalPastaFarm = await guild.channels.fetch(process.env.CANAL_PASTA_FARM_ID);
            await canalPastaFarm.bulkDelete(100);
            await enviarMenuPastaFarm(canalPastaFarm);
            
            // Canal de encomendas (se configurado)
            if (process.env.CANAL_ENCOMENDAS_ID) {
                try {
                    const canalEncomendas = await guild.channels.fetch(process.env.CANAL_ENCOMENDAS_ID);
                    await canalEncomendas.bulkDelete(100);
                    await enviarMenuEncomendas(canalEncomendas);
                    console.log('✅ Menu de encomendas inicializado!');
                } catch (error) {
                    console.error('❌ Erro ao inicializar canal de encomendas:', error.message);
                }
            }
            
            // Verificar canal de logs de registros (apenas verificar, não limpar)
            if (process.env.CANAL_LOG_REGISTROS_ID) {
                try {
                    const canalLogRegistros = await guild.channels.fetch(process.env.CANAL_LOG_REGISTROS_ID);
                    console.log('✅ Canal de logs de registros verificado:', canalLogRegistros.name);
                    
                    // Enviar mensagem inicial se o canal estiver vazio
                    const messages = await canalLogRegistros.messages.fetch({ limit: 1 });
                    if (messages.size === 0) {
                        const { EmbedBuilder } = require('discord.js');
                        const embed = new EmbedBuilder()
                            .setTitle('📋 LOGS DE REGISTRO DE MEMBROS')
                            .setDescription('Este canal registra todos os registros de novos membros da facção.\n\n**Apenas gerência tem acesso a este canal.**')
                            .setColor(0x00AE86)
                            .addFields(
                                { name: '📊 Estatísticas', value: 'Todos os registros serão mostrados aqui com detalhes completos.' },
                                { name: '🛠️ Funcionalidades', value: '• Log automático de cada registro\n• Botões de ação rápida\n• Sistema de promoção\n• Histórico completo' }
                            )
                            .setFooter({ text: 'Sistema de Registro - Facção' })
                            .setTimestamp();
                        
                        await canalLogRegistros.send({ embeds: [embed] });
                        console.log('✅ Mensagem inicial enviada no canal de logs de registros');
                    }
                } catch (error) {
                    console.error('❌ Erro ao verificar canal de logs de registros:', error.message);
                }
            }
            
            // Verificar canal de logs de encomendas (se configurado)
            if (process.env.CANAL_LOG_ENCOMENDAS_ID) {
                try {
                    const canalLogEncomendas = await guild.channels.fetch(process.env.CANAL_LOG_ENCOMENDAS_ID);
                    console.log('✅ Canal de logs de encomendas verificado:', canalLogEncomendas.name);
                } catch (error) {
                    console.error('❌ Erro ao verificar canal de logs de encomendas:', error.message);
                }
            }
            
            console.log('✅ Todos os menus e canais inicializados com sucesso!');
            
        } catch (error) {
            console.error('❌ Erro ao inicializar menus:', error);
        }
    },
};