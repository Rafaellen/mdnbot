const { EmbedBuilder } = require('discord.js');
const supabase = require('../database/supabase');

/**
 * Registrar log de novo membro
 * @param {Object} membro - Dados do membro
 * @param {string} registradoPor - Discord ID de quem registrou
 * @param {string} tipoAcao - Tipo de ação (registro, atualizacao, exclusao)
 */
async function registrarLogMembro(membro, registradoPor, tipoAcao = 'registro') {
    try {
        const { error } = await supabase
            .from('logs_registro')
            .insert([
                {
                    membro_id: membro.id,
                    discord_id: membro.discord_id,
                    nome: membro.nome,
                    telefone: membro.telefone || null,
                    recrutador: membro.recrutador || null,
                    hierarquia: membro.hierarquia || 'Membro',
                    registrado_por: registradoPor,
                    tipo_acao: tipoAcao
                }
            ]);

        if (error) {
            console.error('❌ Erro ao registrar log de membro:', error);
            return false;
        }

        console.log(`✅ Log de ${tipoAcao} registrado para ${membro.nome} (${membro.discord_id})`);
        return true;
    } catch (error) {
        console.error('❌ Erro ao registrar log:', error);
        return false;
    }
}

/**
 * Enviar notificação de novo membro para canal de logs
 * @param {Object} client - Cliente do Discord
 * @param {Object} membro - Dados do membro
 * @param {Object} registrante - Usuário que registrou
 * @param {string} idInGame - ID in-game do membro
 */
async function enviarLogRegistroDiscord(client, membro, registrante, idInGame) {
    try {
        const canalLogId = process.env.CANAL_LOG_REGISTROS_ID;
        if (!canalLogId) {
            console.log('⚠️  Canal de log de registros não configurado.');
            return;
        }

        const canalLog = await client.channels.fetch(canalLogId);
        if (!canalLog) {
            console.log('⚠️  Canal de log de registros não encontrado.');
            return;
        }

        // Criar embed detalhado
        const embed = new EmbedBuilder()
            .setTitle('📋 NOVO MEMBRO REGISTRADO')
            .setColor(0x00AE86)
            .setThumbnail(`https://cdn.discordapp.com/avatars/${membro.discord_id}/${registrante.avatar}.png?size=256`)
            .addFields(
                { name: '👤 Nome', value: membro.nome, inline: true },
                { name: '🆔 ID In-Game', value: idInGame || 'Não informado', inline: true },
                { name: '📱 Telefone', value: membro.telefone || 'Não informado', inline: true },
                { name: '🎯 Recrutador', value: membro.recrutador || 'Não informado', inline: true },
                { name: '📊 Hierarquia', value: membro.hierarquia || 'Membro', inline: true },
                { name: '🆔 Discord ID', value: membro.discord_id, inline: true },
                { name: '📅 Data de Registro', value: new Date().toLocaleString('pt-BR'), inline: true },
                { name: '🛠️ Registrado por', value: `${registrante.username} (${registrante.id})`, inline: true }
            )
            .setFooter({ text: 'Sistema de Registro - Facção' })
            .setTimestamp();

        // Verificar se o membro já está no servidor
        try {
            const guild = await client.guilds.fetch(process.env.GUILD_ID);
            const member = await guild.members.fetch(membro.discord_id);
            
            if (member) {
                embed.addFields(
                    { name: '📅 Entrou no Discord', value: new Date(member.joinedTimestamp).toLocaleDateString('pt-BR'), inline: true },
                    { name: '👥 Cargos no Discord', value: member.roles.cache.size > 1 ? 
                        member.roles.cache.filter(r => r.id !== guild.id).map(r => r.name).join(', ') : 'Nenhum cargo adicional', 
                        inline: false }
                );
            }
        } catch (error) {
            // Membro não encontrado no servidor (pode ser normal se acabou de registrar)
            console.log('ℹ️  Membro não encontrado no servidor ainda:', error.message);
        }

        // Botões de ação rápida
        const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
        
        const botoesLog = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`ver_membro_${membro.discord_id}`)
                    .setLabel('🔍 VER PERFIL')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('🔍'),
                new ButtonBuilder()
                    .setCustomId(`promover_${membro.discord_id}`)
                    .setLabel('⬆️ PROMOVER')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('⬆️'),
                new ButtonBuilder()
                    .setStyle(ButtonStyle.Link)
                    .setLabel('💬 ENVIAR DM')
                    .setURL(`discord://-/users/${membro.discord_id}`)
                    .setEmoji('💬')
            );

        await canalLog.send({
            content: `📋 **NOVO MEMBRO REGISTRADO!** <@&${process.env.CARGO_GERENCIA_ID}>`,
            embeds: [embed],
            components: [botoesLog]
        });

        console.log(`✅ Log de registro enviado para canal de logs: ${membro.nome}`);

    } catch (error) {
        console.error('❌ Erro ao enviar log para Discord:', error);
    }
}

/**
 * Buscar histórico de registros
 * @param {Object} options - Opções de filtro
 * @returns {Promise<Array>} Lista de logs
 */
async function buscarLogsRegistro(options = {}) {
    try {
        let query = supabase
            .from('logs_registro')
            .select('*')
            .order('data_registro', { ascending: false });

        // Aplicar filtros
        if (options.limit) {
            query = query.limit(options.limit);
        }

        if (options.discord_id) {
            query = query.eq('discord_id', options.discord_id);
        }

        if (options.data_inicio && options.data_fim) {
            query = query.gte('data_registro', options.data_inicio)
                         .lte('data_registro', options.data_fim);
        }

        if (options.tipo_acao) {
            query = query.eq('tipo_acao', options.tipo_acao);
        }

        const { data, error } = await query;

        if (error) {
            console.error('❌ Erro ao buscar logs:', error);
            return [];
        }

        return data || [];
    } catch (error) {
        console.error('❌ Erro ao buscar logs de registro:', error);
        return [];
    }
}

/**
 * Gerar relatório de registros
 * @param {Date} dataInicio - Data inicial
 * @param {Date} dataFim - Data final
 * @returns {Promise<Object>} Relatório
 */
async function gerarRelatorioRegistros(dataInicio, dataFim) {
    try {
        const { data, error } = await supabase
            .from('logs_registro')
            .select('*')
            .gte('data_registro', dataInicio.toISOString())
            .lte('data_registro', dataFim.toISOString())
            .order('data_registro', { ascending: true });

        if (error) throw error;

        const total = data?.length || 0;
        const porRecrutador = {};
        const porDia = {};

        if (data && data.length > 0) {
            data.forEach(log => {
                // Contar por recrutador
                const recrutador = log.recrutador || 'Não informado';
                porRecrutador[recrutador] = (porRecrutador[recrutador] || 0) + 1;

                // Contar por dia
                const dataDia = new Date(log.data_registro).toLocaleDateString('pt-BR');
                porDia[dataDia] = (porDia[dataDia] || 0) + 1;
            });
        }

        return {
            total,
            porRecrutador,
            porDia,
            registros: data || []
        };
    } catch (error) {
        console.error('❌ Erro ao gerar relatório:', error);
        return { total: 0, porRecrutador: {}, porDia: {}, registros: [] };
    }
}

module.exports = {
    registrarLogMembro,
    enviarLogRegistroDiscord,
    buscarLogsRegistro,
    gerarRelatorioRegistros
};