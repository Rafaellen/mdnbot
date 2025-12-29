const { 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    EmbedBuilder, 
    ModalBuilder, 
    TextInputBuilder, 
    TextInputStyle,
    StringSelectMenuBuilder 
} = require('discord.js');
const supabase = require('../database/supabase');

// Enviar menu de encomendas no canal
async function enviarMenuEncomendas(canal) {
    const embed = new EmbedBuilder()
        .setTitle('🛒 SISTEMA DE ENCOMENDAS')
        .setDescription('Clique no botão abaixo para iniciar uma nova encomenda.\n\n**Produtos disponíveis:**\n• Chip: $1.500/unidade\n• Hacking: $500/unidade\n• Pendrive de invasão: $1.000/unidade\n• Jammer: $2.500/unidade\n• Cartão Criptografado: $100.000/unidade')
        .setColor(0x9B59B6)
        .addFields(
            { name: '⚠️ ATENÇÃO', value: 'Apenas gerência pode criar encomendas.' },
            { name: '📋 Processo:', value: '1. Clique em "Iniciar Encomenda"\n2. Preencha os dados do cliente\n3. Selecione os produtos\n4. Confirme a encomenda' }
        )
        .setFooter({ text: 'Sistema de Encomendas - Facção' });

    const botao = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('iniciar_encomenda')
                .setLabel('INICIAR ENCOMENDA')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('🛒')
        );

    await canal.send({ embeds: [embed], components: [botao] });
}

// Modal para iniciar encomenda
async function iniciarEncomendaModal(interaction) {
    const modal = new ModalBuilder()
        .setCustomId('encomenda_modal')
        .setTitle('Nova Encomenda');

    const clienteInput = new TextInputBuilder()
        .setCustomId('cliente_input')
        .setLabel("Nome do Cliente")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("Ex: João Silva")
        .setRequired(true)
        .setMaxLength(100);

    const observacoesInput = new TextInputBuilder()
        .setCustomId('observacoes_input')
        .setLabel("Observações (opcional)")
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder("Detalhes adicionais sobre a encomenda...")
        .setRequired(false)
        .setMaxLength(500);

    const primeiraLinha = new ActionRowBuilder().addComponents(clienteInput);
    const segundaLinha = new ActionRowBuilder().addComponents(observacoesInput);

    modal.addComponents(primeiraLinha, segundaLinha);
    await interaction.showModal(modal);
}

// Processar modal e mostrar seleção de produtos
async function processarModalEncomenda(interaction) {
    try {
        await interaction.deferReply({ flags: 64 });
        
        const clienteNome = interaction.fields.getTextInputValue('cliente_input');
        const observacoes = interaction.fields.getTextInputValue('observacoes_input') || '';
        
        // Verificar se é gerência
        const isGerencia = interaction.member.roles.cache.has(process.env.CARGO_GERENCIA_ID) || 
                           interaction.member.roles.cache.has(process.env.CARGO_LIDER_ID);
        
        if (!isGerencia) {
            return interaction.editReply({
                content: '❌ Apenas gerência pode criar encomendas!',
                flags: 64
            });
        }
        
        // Buscar produtos disponíveis
        const { data: produtos, error } = await supabase
            .from('produtos')
            .select('*')
            .eq('ativo', true)
            .order('nome');
        
        if (error) throw error;
        
        if (!produtos || produtos.length === 0) {
            return interaction.editReply({
                content: '❌ Nenhum produto disponível no momento!',
                flags: 64
            });
        }
        
        // Salvar dados temporários
        const dadosTemporarios = {
            clienteNome,
            observacoes,
            atendenteId: interaction.user.id,
            produtos: produtos.map(p => ({
                id: p.id,
                nome: p.nome,
                valor: p.valor_unitario,
                quantidade: 0
            }))
        };
        
        // Armazenar temporariamente
        global.encomendasTemporarias = global.encomendasTemporarias || {};
        const tempId = Date.now().toString();
        global.encomendasTemporarias[tempId] = dadosTemporarios;
        
        // Criar menu de seleção de produtos
        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId(`selecionar_produto_${tempId}`)
            .setPlaceholder('Selecione um produto para adicionar')
            .addOptions(
                produtos.map(produto => ({
                    label: produto.nome,
                    description: `$${produto.valor_unitario.toLocaleString('pt-BR')} cada`,
                    value: produto.id.toString(),
                    emoji: getProdutoEmoji(produto.nome)
                }))
            );
        
        const row = new ActionRowBuilder().addComponents(selectMenu);
        
        const embed = new EmbedBuilder()
            .setTitle('🛒 NOVA ENCOMENDA')
            .setColor(0x3498DB)
            .addFields(
                { name: '👤 Cliente', value: clienteNome, inline: true },
                { name: '🛠️ Atendente', value: interaction.user.username, inline: true },
                { name: '📝 Observações', value: observacoes || 'Nenhuma', inline: false }
            )
            .setDescription('Selecione os produtos abaixo:');
        
        // Botão para finalizar seleção
        const botaoFinalizar = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`finalizar_selecao_${tempId}`)
                    .setLabel('FINALIZAR SELEÇÃO')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('✅'),
                new ButtonBuilder()
                    .setCustomId(`cancelar_encomenda_temp_${tempId}`)
                    .setLabel('CANCELAR')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('❌')
            );
        
        await interaction.editReply({
            content: `**Selecione os produtos para ${clienteNome}:**`,
            embeds: [embed],
            components: [row, botaoFinalizar]
        });
        
    } catch (error) {
        console.error('❌ Erro ao processar modal de encomenda:', error);
        await interaction.editReply({
            content: `❌ Erro: ${error.message}`,
            flags: 64
        });
    }
}

// Modal para quantidade do produto
async function mostrarModalQuantidade(interaction, produtoId, tempId) {
    if (!global.encomendasTemporarias || !global.encomendasTemporarias[tempId]) {
        return interaction.reply({
            content: '❌ Sessão expirada! Por favor, inicie novamente.',
            flags: 64
        });
    }
    
    const dados = global.encomendasTemporarias[tempId];
    const produto = dados.produtos.find(p => p.id == produtoId);
    
    if (!produto) {
        return interaction.reply({
            content: '❌ Produto não encontrado!',
            flags: 64
        });
    }
    
    const modal = new ModalBuilder()
        .setCustomId(`quantidade_modal_${produtoId}_${tempId}`)
        .setTitle(`Quantidade: ${produto.nome}`);
    
    const quantidadeInput = new TextInputBuilder()
        .setCustomId('quantidade_input')
        .setLabel(`Quantidade de ${produto.nome}`)
        .setStyle(TextInputStyle.Short)
        .setPlaceholder(`Digite a quantidade (Valor unitário: $${produto.valor.toLocaleString('pt-BR')})`)
        .setRequired(true)
        .setMaxLength(10);
    
    const linha = new ActionRowBuilder().addComponents(quantidadeInput);
    modal.addComponents(linha);
    
    await interaction.showModal(modal);
}

// Processar quantidade e atualizar carrinho
async function processarQuantidadeProduto(interaction) {
    try {
        await interaction.deferReply({ flags: 64 });
        
        const customIdParts = interaction.customId.split('_');
        const produtoId = customIdParts[2];
        const tempId = customIdParts[3];
        const quantidade = interaction.fields.getTextInputValue('quantidade_input');
        
        if (!global.encomendasTemporarias || !global.encomendasTemporarias[tempId]) {
            return interaction.editReply({
                content: '❌ Sessão expirada! Por favor, inicie novamente.',
                flags: 64
            });
        }
        
        const quantidadeNum = parseInt(quantidade);
        if (isNaN(quantidadeNum) || quantidadeNum <= 0) {
            return interaction.editReply({
                content: '❌ Quantidade inválida! Digite um número maior que 0.',
                flags: 64
            });
        }
        
        if (quantidadeNum > 1000) {
            return interaction.editReply({
                content: '❌ Quantidade muito alta! Máximo: 1000 unidades.',
                flags: 64
            });
        }
        
        // Atualizar quantidade
        const dados = global.encomendasTemporarias[tempId];
        const produtoIndex = dados.produtos.findIndex(p => p.id == produtoId);
        
        if (produtoIndex === -1) {
            return interaction.editReply({
                content: '❌ Produto não encontrado!',
                flags: 64
            });
        }
        
        dados.produtos[produtoIndex].quantidade = quantidadeNum;
        global.encomendasTemporarias[tempId] = dados;
        
        // Calcular total
        const total = dados.produtos.reduce((sum, p) => sum + (p.valor * p.quantidade), 0);
        
        const embed = criarEmbedCarrinho(dados, total);
        
        // Atualizar mensagem
        await interaction.editReply({
            content: `✅ **${quantidadeNum} ${dados.produtos[produtoIndex].nome} adicionado(s)!**\n\nTotal atual: **$${total.toLocaleString('pt-BR')}**`,
            embeds: [embed]
        });
        
    } catch (error) {
        console.error('❌ Erro ao processar quantidade:', error);
        await interaction.editReply({
            content: `❌ Erro: ${error.message}`,
            flags: 64
        });
    }
}

// Finalizar encomenda e enviar para canal de logs
async function finalizarEncomenda(interaction, tempId) {
    try {
        await interaction.deferReply({ flags: 64 });
        
        if (!global.encomendasTemporarias || !global.encomendasTemporarias[tempId]) {
            return interaction.editReply({
                content: '❌ Sessão expirada! Por favor, inicie novamente.',
                flags: 64
            });
        }
        
        const dados = global.encomendasTemporarias[tempId];
        const produtosSelecionados = dados.produtos.filter(p => p.quantidade > 0);
        
        if (produtosSelecionados.length === 0) {
            return interaction.editReply({
                content: '❌ Nenhum produto selecionado!',
                flags: 64
            });
        }
        
        const total = produtosSelecionados.reduce((sum, p) => sum + (p.valor * p.quantidade), 0);
        
        // Salvar encomenda no banco
        const { data: encomenda, error: errorEncomenda } = await supabase
            .from('encomendas')
            .insert([
                {
                    cliente_nome: dados.clienteNome,
                    cliente_discord_id: null,
                    status: 'pendente',
                    valor_total: total,
                    atendente_id: dados.atendenteId,
                    observacoes: dados.observacoes
                }
            ])
            .select()
            .single();
        
        if (errorEncomenda) throw errorEncomenda;
        
        // Salvar itens da encomenda
        for (const produto of produtosSelecionados) {
            const { error: errorItem } = await supabase
                .from('encomenda_itens')
                .insert([
                    {
                        encomenda_id: encomenda.id,
                        produto_id: produto.id,
                        quantidade: produto.quantidade,
                        valor_unitario: produto.valor,
                        valor_total: produto.valor * produto.quantidade
                    }
                ]);
            
            if (errorItem) {
                console.error('❌ Erro ao salvar item:', errorItem);
            }
        }
        
        // Limpar dados temporários
        delete global.encomendasTemporarias[tempId];
        
        // Enviar log para canal de logs
        await enviarLogEncomenda(interaction.client, encomenda, dados, produtosSelecionados, total, interaction.user);
        
        // Limpar o canal de encomendas (deletar todas as mensagens exceto a inicial)
        await limparCanalEncomendas(interaction.channel);
        
        // Enviar confirmação
        await interaction.editReply({
            content: `✅ **ENCOMENDA #${encomenda.id} CRIADA COM SUCESSO!**\n\n📦 **ID:** #${encomenda.id}\n👤 **Cliente:** ${dados.clienteNome}\n💰 **Valor:** $${total.toLocaleString('pt-BR')}\n\nA encomenda foi registrada no sistema de logs.`
        });
        
        // Após 5 segundos, deletar esta mensagem também
        setTimeout(async () => {
            try {
                await interaction.deleteReply();
            } catch (error) {
                console.log('⚠️  Não foi possível deletar mensagem de confirmação:', error.message);
            }
        }, 5000);
        
    } catch (error) {
        console.error('❌ Erro ao finalizar encomenda:', error);
        await interaction.editReply({
            content: `❌ Erro ao criar encomenda: ${error.message}`,
            flags: 64
        });
    }
}

// Função para limpar canal de encomendas
async function limparCanalEncomendas(canal) {
    try {
        // Buscar mensagens (exceto a primeira que tem o menu)
        const messages = await canal.messages.fetch({ limit: 100 });
        
        // Encontrar a mensagem do menu (tem embed com título "SISTEMA DE ENCOMENDAS")
        let menuMessage = null;
        for (const [id, message] of messages) {
            if (message.embeds.length > 0 && 
                message.embeds[0].title && 
                message.embeds[0].title.includes('SISTEMA DE ENCOMENDAS')) {
                menuMessage = message;
                break;
            }
        }
        
        // Deletar todas as mensagens exceto o menu
        const messagesToDelete = messages.filter(msg => 
            msg.id !== menuMessage?.id && 
            !msg.pinned
        );
        
        if (messagesToDelete.size > 0) {
            console.log(`🗑️  Limpando ${messagesToDelete.size} mensagens do canal de encomendas`);
            
            // Deletar em lotes de 100 (limite do Discord)
            const batches = [];
            let currentBatch = [];
            let count = 0;
            
            messagesToDelete.forEach(msg => {
                currentBatch.push(msg);
                count++;
                
                if (count === 100) {
                    batches.push([...currentBatch]);
                    currentBatch = [];
                    count = 0;
                }
            });
            
            if (currentBatch.length > 0) {
                batches.push(currentBatch);
            }
            
            // Deletar cada lote
            for (const batch of batches) {
                try {
                    await canal.bulkDelete(batch);
                    await new Promise(resolve => setTimeout(resolve, 1000)); // Aguardar 1s entre lotes
                } catch (error) {
                    console.log('⚠️  Erro ao deletar lote:', error.message);
                }
            }
        }
        
    } catch (error) {
        console.error('❌ Erro ao limpar canal de encomendas:', error);
    }
}

// Enviar log para canal de logs
async function enviarLogEncomenda(client, encomenda, dados, produtos, total, atendente) {
    try {
        const canalLogId = process.env.CANAL_LOG_ENCOMENDAS_ID;
        if (!canalLogId) {
            console.log('⚠️  Canal de log de encomendas não configurado.');
            return;
        }
        
        const canalLog = await client.channels.fetch(canalLogId);
        if (!canalLog) {
            console.log('⚠️  Canal de log não encontrado.');
            return;
        }
        
        // Criar embed detalhado da encomenda
        const embedLog = new EmbedBuilder()
            .setTitle(`📦 ENCOMENDA #${encomenda.id}`)
            .setColor(0x9B59B6)
            .addFields(
                { name: '👤 Cliente', value: dados.clienteNome, inline: true },
                { name: '💰 Valor Total', value: `$${total.toLocaleString('pt-BR')}`, inline: true },
                { name: '📊 Status', value: '⏳ Pendente', inline: true },
                { name: '🛠️ Atendente', value: atendente.username, inline: true },
                { name: '📅 Data', value: new Date().toLocaleString('pt-BR'), inline: true }
            );
        
        if (dados.observacoes) {
            embedLog.addFields({
                name: '📝 Observações',
                value: dados.observacoes,
                inline: false
            });
        }
        
        // Adicionar detalhes dos produtos
        let produtosText = '';
        produtos.forEach((produto, index) => {
            produtosText += `**${produto.nome}**\n`;
            produtosText += `Quantidade: ${produto.quantidade} × $${produto.valor.toLocaleString('pt-BR')}\n`;
            produtosText += `Subtotal: $${(produto.valor * produto.quantidade).toLocaleString('pt-BR')}\n\n`;
        });
        
        embedLog.addFields({
            name: '📋 Produtos Encomendados',
            value: produtosText,
            inline: false
        });
        
        // Botões para gerenciar a encomenda
        const botoesLog = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`finalizar_encomenda_${encomenda.id}`)
                    .setLabel('✅ FINALIZAR ENCOMENDA')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('✅'),
                new ButtonBuilder()
                    .setCustomId(`cancelar_encomenda_log_${encomenda.id}`)
                    .setLabel('❌ CANCELAR')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('❌')
            );
        
        const mensagemLog = await canalLog.send({
            content: `📦 **NOVA ENCOMENDA REGISTRADA!** - #${encomenda.id}`,
            embeds: [embedLog],
            components: [botoesLog]
        });
        
        // Atualizar encomenda com ID da mensagem de log
        await supabase
            .from('encomendas')
            .update({
                mensagem_id: mensagemLog.id
            })
            .eq('id', encomenda.id);
        
        console.log(`✅ Log da encomenda #${encomenda.id} enviado para canal de logs`);
        
    } catch (error) {
        console.error('❌ Erro ao enviar log:', error);
    }
}

// Funções auxiliares
function criarEmbedCarrinho(dados, total) {
    const produtosSelecionados = dados.produtos.filter(p => p.quantidade > 0);
    
    const embed = new EmbedBuilder()
        .setTitle('🛒 CARRINHO DE ENCOMENDA')
        .setColor(0xF1C40F)
        .addFields(
            { name: '👤 Cliente', value: dados.clienteNome, inline: true },
            { name: '💰 Total Parcial', value: `$${total.toLocaleString('pt-BR')}`, inline: true },
            { name: '📋 Itens', value: produtosSelecionados.length.toString(), inline: true }
        );
    
    if (produtosSelecionados.length > 0) {
        let itensText = '';
        produtosSelecionados.forEach((produto, index) => {
            itensText += `**${produto.nome}**\n`;
            itensText += `Quantidade: ${produto.quantidade} × $${produto.valor.toLocaleString('pt-BR')} = $${(produto.valor * produto.quantidade).toLocaleString('pt-BR')}\n\n`;
        });
        
        embed.addFields({ name: '📦 Produtos Selecionados', value: itensText, inline: false });
    } else {
        embed.addFields({ name: '📦 Produtos Selecionados', value: 'Nenhum produto selecionado ainda.', inline: false });
    }
    
    return embed;
}

function getProdutoEmoji(nome) {
    const emojis = {
        'Chip': '📱',
        'Hacking': '💻',
        'Pendrive de invasão': '💾',
        'Jammer': '📡',
        'Cartão Criptografado': '💳'
    };
    return emojis[nome] || '📦';
}

module.exports = {
    enviarMenuEncomendas,
    iniciarEncomendaModal,
    processarModalEncomenda,
    mostrarModalQuantidade,
    processarQuantidadeProduto,
    finalizarEncomenda
};