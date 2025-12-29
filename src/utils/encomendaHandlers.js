const supabase = require('../database/supabase');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

// Finalizar uma encomenda
async function finalizarEncomendaHandler(interaction, encomendaId) {
    try {
        await interaction.deferReply({ flags: 64 });
        
        // Verificar se é gerência
        const isGerencia = interaction.member.roles.cache.has(process.env.CARGO_GERENCIA_ID) || 
                           interaction.member.roles.cache.has(process.env.CARGO_LIDER_ID);
        
        if (!isGerencia) {
            return interaction.editReply({
                content: '❌ Apenas gerência pode finalizar encomendas!',
                flags: 64
            });
        }
        
        // Buscar encomenda
        const { data: encomenda, error } = await supabase
            .from('encomendas')
            .select(`
                *,
                encomenda_itens (
                    quantidade,
                    valor_unitario,
                    valor_total,
                    produtos (
                        nome
                    )
                )
            `)
            .eq('id', encomendaId)
            .single();
        
        if (error || !encomenda) {
            return interaction.editReply({
                content: '❌ Encomenda não encontrada!',
                flags: 64
            });
        }
        
        if (encomenda.status === 'finalizada') {
            return interaction.editReply({
                content: '⚠️ Esta encomenda já foi finalizada!',
                flags: 64
            });
        }
        
        if (encomenda.status === 'cancelada') {
            return interaction.editReply({
                content: '❌ Encomenda cancelada não pode ser finalizada!',
                flags: 64
            });
        }
        
        // Atualizar encomenda
        const { error: updateError } = await supabase
            .from('encomendas')
            .update({
                status: 'finalizada',
                data_finalizacao: new Date().toISOString()
            })
            .eq('id', encomendaId);
        
        if (updateError) throw updateError;
        
        // Atualizar mensagem no canal de logs
        const embed = new EmbedBuilder()
            .setTitle(`✅ ENCOMENDA #${encomendaId} FINALIZADA`)
            .setColor(0x2ECC71)
            .addFields(
                { name: '👤 Cliente', value: encomenda.cliente_nome, inline: true },
                { name: '💰 Valor Total', value: `$${encomenda.valor_total.toLocaleString('pt-BR')}`, inline: true },
                { name: '📊 Status', value: '✅ Finalizada', inline: true },
                { name: '🛠️ Finalizada por', value: interaction.user.username, inline: true },
                { name: '📅 Data de Finalização', value: new Date().toLocaleString('pt-BR'), inline: true }
            );
        
        // Adicionar detalhes dos produtos
        if (encomenda.encomenda_itens && encomenda.encomenda_itens.length > 0) {
            let produtosText = '';
            encomenda.encomenda_itens.forEach((item, index) => {
                produtosText += `**${item.produtos.nome}**\n`;
                produtosText += `Quantidade: ${item.quantidade} × $${item.valor_unitario.toLocaleString('pt-BR')}\n`;
                produtosText += `Subtotal: $${item.valor_total.toLocaleString('pt-BR')}\n\n`;
            });
            
            embed.addFields({
                name: '📋 Produtos Entregues',
                value: produtosText,
                inline: false
            });
        }
        
        // Remover botões da mensagem original
        await interaction.message.edit({
            content: `✅ **ENCOMENDA #${encomendaId} FINALIZADA**\n\n🛠️ Finalizada por: ${interaction.user.username}`,
            embeds: [embed],
            components: []
        });
        
        await interaction.editReply({
            content: `✅ **Encomenda #${encomendaId} finalizada com sucesso!**`
        });
        
        // Atualizar log
        await atualizarLogEncomenda(interaction.client, encomendaId, 'finalizada', interaction.user.id);
        
    } catch (error) {
        console.error('❌ Erro ao finalizar encomenda:', error);
        await interaction.editReply({
            content: `❌ Erro: ${error.message}`,
            flags: 64
        });
    }
}

// Cancelar uma encomenda
async function cancelarEncomendaHandler(interaction, encomendaId) {
    try {
        await interaction.deferReply({ flags: 64 });
        
        // Verificar se é gerência
        const isGerencia = interaction.member.roles.cache.has(process.env.CARGO_GERENCIA_ID) || 
                           interaction.member.roles.cache.has(process.env.CARGO_LIDER_ID);
        
        if (!isGerencia) {
            return interaction.editReply({
                content: '❌ Apenas gerência pode cancelar encomendas!',
                flags: 64
            });
        }
        
        // Buscar encomenda
        const { data: encomenda, error } = await supabase
            .from('encomendas')
            .select('*')
            .eq('id', encomendaId)
            .single();
        
        if (error || !encomenda) {
            return interaction.editReply({
                content: '❌ Encomenda não encontrada!',
                flags: 64
            });
        }
        
        if (encomenda.status === 'cancelada') {
            return interaction.editReply({
                content: '⚠️ Esta encomenda já foi cancelada!',
                flags: 64
            });
        }
        
        // Atualizar encomenda
        const { error: updateError } = await supabase
            .from('encomendas')
            .update({
                status: 'cancelada'
            })
            .eq('id', encomendaId);
        
        if (updateError) throw updateError;
        
        // Atualizar mensagem no canal
        const embed = new EmbedBuilder()
            .setTitle(`❌ ENCOMENDA #${encomendaId} CANCELADA`)
            .setColor(0xE74C3C)
            .addFields(
                { name: '👤 Cliente', value: encomenda.cliente_nome, inline: true },
                { name: '💰 Valor Total', value: `$${encomenda.valor_total.toLocaleString('pt-BR')}`, inline: true },
                { name: '🛠️ Cancelada por', value: interaction.user.username, inline: true },
                { name: '📅 Data de Cancelamento', value: new Date().toLocaleString('pt-BR'), inline: true }
            );
        
        // Remover botões da mensagem original
        await interaction.message.edit({
            content: `❌ **ENCOMENDA #${encomendaId} CANCELADA**\n\n🛠️ Cancelada por: ${interaction.user.username}`,
            embeds: [embed],
            components: []
        });
        
        await interaction.editReply({
            content: `❌ **Encomenda #${encomendaId} cancelada!**`
        });
        
        // Atualizar log
        await atualizarLogEncomenda(interaction.client, encomendaId, 'cancelada', interaction.user.id);
        
    } catch (error) {
        console.error('❌ Erro ao cancelar encomenda:', error);
        await interaction.editReply({
            content: `❌ Erro: ${error.message}`,
            flags: 64
        });
    }
}

// Cancelar encomenda do canal de logs
async function cancelarEncomendaLogHandler(interaction, encomendaId) {
    try {
        await interaction.deferReply({ flags: 64 });
        
        // Verificar se é gerência
        const isGerencia = interaction.member.roles.cache.has(process.env.CARGO_GERENCIA_ID) || 
                           interaction.member.roles.cache.has(process.env.CARGO_LIDER_ID);
        
        if (!isGerencia) {
            return interaction.editReply({
                content: '❌ Apenas gerência pode cancelar encomendas!',
                flags: 64
            });
        }
        
        // Buscar encomenda
        const { data: encomenda, error } = await supabase
            .from('encomendas')
            .select('*')
            .eq('id', encomendaId)
            .single();
        
        if (error || !encomenda) {
            return interaction.editReply({
                content: '❌ Encomenda não encontrada!',
                flags: 64
            });
        }
        
        if (encomenda.status === 'cancelada') {
            return interaction.editReply({
                content: '⚠️ Esta encomenda já foi cancelada!',
                flags: 64
            });
        }
        
        // Atualizar encomenda
        const { error: updateError } = await supabase
            .from('encomendas')
            .update({
                status: 'cancelada'
            })
            .eq('id', encomendaId);
        
        if (updateError) throw updateError;
        
        // Atualizar mensagem no canal de logs
        const embed = EmbedBuilder.from(interaction.message.embeds[0])
            .setColor(0xE74C3C)
            .spliceFields(2, 1, { 
                name: '📊 Status', 
                value: '❌ Cancelada', 
                inline: true 
            });
        
        await interaction.message.edit({
            content: `❌ **ENCOMENDA #${encomendaId} CANCELADA**\n\n🛠️ Cancelada por: ${interaction.user.username}`,
            embeds: [embed],
            components: []
        });
        
        await interaction.editReply({
            content: `❌ **Encomenda #${encomendaId} cancelada!**`
        });
        
        // Atualizar log
        await atualizarLogEncomenda(interaction.client, encomendaId, 'cancelada', interaction.user.id);
        
    } catch (error) {
        console.error('❌ Erro ao cancelar encomenda do log:', error);
        await interaction.editReply({
            content: `❌ Erro: ${error.message}`,
            flags: 64
        });
    }
}

// Atualizar log no canal de logs
async function atualizarLogEncomenda(client, encomendaId, status, userId) {
    try {
        const canalLogId = process.env.CANAL_LOG_ENCOMENDAS_ID;
        if (!canalLogId) return;
        
        const canalLog = await client.channels.fetch(canalLogId);
        if (!canalLog) return;
        
        // Buscar encomenda para obter mensagem_id
        const { data: encomenda } = await supabase
            .from('encomendas')
            .select('mensagem_id')
            .eq('id', encomendaId)
            .single();
        
        if (!encomenda || !encomenda.mensagem_id) return;
        
        // Buscar a mensagem específica
        let logMessage;
        try {
            logMessage = await canalLog.messages.fetch(encomenda.mensagem_id);
        } catch (error) {
            console.log('❌ Mensagem de log não encontrada:', error.message);
            return;
        }
        
        if (logMessage) {
            const statusEmoji = status === 'finalizada' ? '✅' : '❌';
            const statusText = status === 'finalizada' ? 'Finalizada' : 'Cancelada';
            const statusColor = status === 'finalizada' ? 0x2ECC71 : 0xE74C3C;
            
            // Atualizar o embed
            const novoEmbed = EmbedBuilder.from(logMessage.embeds[0])
                .setColor(statusColor)
                .spliceFields(2, 1, { 
                    name: '📊 Status', 
                    value: `${statusEmoji} ${statusText}`, 
                    inline: true 
                });
            
            // Atualizar conteúdo e remover botões
            await logMessage.edit({
                content: `${status === 'finalizada' ? '✅' : '❌'} **ENCOMENDA #${encomendaId} ${statusText.toUpperCase()}**\n\n🛠️ ${status === 'finalizada' ? 'Finalizada' : 'Cancelada'} por: <@${userId}>`,
                embeds: [novoEmbed],
                components: []
            });
        }
        
    } catch (error) {
        console.error('❌ Erro ao atualizar log:', error);
    }
}

module.exports = {
    finalizarEncomendaHandler,
    cancelarEncomendaHandler,
    cancelarEncomendaLogHandler,
    atualizarLogEncomenda
};