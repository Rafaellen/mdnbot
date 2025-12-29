const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const supabase = require('../database/supabase');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('encomenda')
        .setDescription('Gerenciar sistema de encomendas')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(subcommand =>
            subcommand
                .setName('status')
                .setDescription('Ver status de uma encomenda')
                .addStringOption(option =>
                    option.setName('id')
                        .setDescription('ID da encomenda')
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('listar')
                .setDescription('Listar todas as encomendas')
                .addStringOption(option =>
                    option.setName('status')
                        .setDescription('Filtrar por status')
                        .setRequired(false)
                        .addChoices(
                            { name: 'Pendente', value: 'pendente' },
                            { name: 'Processando', value: 'processando' },
                            { name: 'Finalizada', value: 'finalizada' },
                            { name: 'Cancelada', value: 'cancelada' }
                        )
                )
        ),
    
    async execute(interaction) {
        await interaction.deferReply({ flags: 64 });
        
        const subcommand = interaction.options.getSubcommand();
        const isGerencia = interaction.member.roles.cache.has(process.env.CARGO_GERENCIA_ID) || 
                           interaction.member.roles.cache.has(process.env.CARGO_LIDER_ID);
        
        if (!isGerencia) {
            return interaction.editReply({
                content: '❌ Apenas gerência pode usar este comando!',
                flags: 64
            });
        }
        
        try {
            if (subcommand === 'status') {
                const encomendaId = interaction.options.getString('id');
                
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
                
                const embed = criarEmbedEncomenda(encomenda);
                await interaction.editReply({ embeds: [embed] });
                
            } else if (subcommand === 'listar') {
                const statusFilter = interaction.options.getString('status');
                
                let query = supabase
                    .from('encomendas')
                    .select('*')
                    .order('created_at', { ascending: false });
                
                if (statusFilter) {
                    query = query.eq('status', statusFilter);
                }
                
                const { data: encomendas, error } = await query;
                
                if (error) {
                    throw error;
                }
                
                if (!encomendas || encomendas.length === 0) {
                    return interaction.editReply({
                        content: '📭 Nenhuma encomenda encontrada.',
                        flags: 64
                    });
                }
                
                const embed = new EmbedBuilder()
                    .setTitle('📋 LISTA DE ENCOMENDAS')
                    .setColor(0x3498DB)
                    .setDescription(`Total de encomendas: ${encomendas.length}`);
                
                encomendas.forEach((enc, index) => {
                    const statusEmoji = getStatusEmoji(enc.status);
                    embed.addFields({
                        name: `#${enc.id} - ${enc.cliente_nome}`,
                        value: `**Status:** ${statusEmoji} ${enc.status}\n**Valor:** $${enc.valor_total.toLocaleString('pt-BR')}\n**Data:** ${new Date(enc.data_pedido).toLocaleDateString('pt-BR')}`,
                        inline: true
                    });
                });
                
                await interaction.editReply({ embeds: [embed] });
            }
            
        } catch (error) {
            console.error('❌ Erro no comando /encomenda:', error);
            await interaction.editReply({
                content: `❌ Erro: ${error.message}`,
                flags: 64
            });
        }
    }
};

function criarEmbedEncomenda(encomenda) {
    const statusEmoji = getStatusEmoji(encomenda.status);
    const embed = new EmbedBuilder()
        .setTitle(`📦 ENCOMENDA #${encomenda.id}`)
        .setColor(getStatusColor(encomenda.status))
        .addFields(
            { name: '👤 Cliente', value: encomenda.cliente_nome, inline: true },
            { name: '📊 Status', value: `${statusEmoji} ${encomenda.status}`, inline: true },
            { name: '💰 Valor Total', value: `$${encomenda.valor_total.toLocaleString('pt-BR')}`, inline: true },
            { name: '📅 Data do Pedido', value: new Date(encomenda.data_pedido).toLocaleString('pt-BR'), inline: true }
        );
    
    if (encomenda.observacoes) {
        embed.addFields({ name: '📝 Observações', value: encomenda.observacoes, inline: false });
    }
    
    if (encomenda.data_finalizacao) {
        embed.addFields({ 
            name: '✅ Data de Finalização', 
            value: new Date(encomenda.data_finalizacao).toLocaleString('pt-BR'), 
            inline: true 
        });
    }
    
    // Adicionar itens
    if (encomenda.encomenda_itens && encomenda.encomenda_itens.length > 0) {
        let itensText = '';
        encomenda.encomenda_itens.forEach((item, index) => {
            itensText += `**${item.produtos.nome}**\n`;
            itensText += `Quantidade: ${item.quantidade} × $${item.valor_unitario.toLocaleString('pt-BR')} = $${item.valor_total.toLocaleString('pt-BR')}\n\n`;
        });
        
        embed.addFields({ name: '📋 Itens da Encomenda', value: itensText, inline: false });
    }
    
    return embed;
}

function getStatusEmoji(status) {
    const emojis = {
        'pendente': '⏳',
        'processando': '🔄',
        'finalizada': '✅',
        'cancelada': '❌'
    };
    return emojis[status] || '❓';
}

function getStatusColor(status) {
    const colors = {
        'pendente': 0xF1C40F, // Amarelo
        'processando': 0x3498DB, // Azul
        'finalizada': 0x2ECC71, // Verde
        'cancelada': 0xE74C3C // Vermelho
    };
    return colors[status] || 0x95A5A6; // Cinza padrão
}