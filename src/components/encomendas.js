const { 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    EmbedBuilder, 
    ModalBuilder, 
    TextInputBuilder, 
    TextInputStyle,
    StringSelectMenuBuilder,
    MessageFlags 
} = require('discord.js');
const supabase = require('../database/supabase');

// Inicializar global se não existir
if (!global.encomendasTemporarias) {
    global.encomendasTemporarias = {};
}

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

// Processar modal e mostrar seleção de produtos
async function processarModalEncomenda(interaction) {
    console.log('📦 Processando dados do modal...');
    
    try {
        const clienteNome = interaction.fields.getTextInputValue('cliente_input');
        const observacoes = interaction.fields.getTextInputValue('observacoes_input') || '';
        
        console.log(`👤 Cliente: ${clienteNome}`);
        console.log(`📝 Observações: ${observacoes || 'Nenhuma'}`);
        
        // Verificar se é gerência (verificação adicional por segurança)
        const isGerencia = interaction.member.roles.cache.has(process.env.CARGO_GERENCIA_ID) || 
                           interaction.member.roles.cache.has(process.env.CARGO_LIDER_ID);
        
        if (!isGerencia) {
            console.log('❌ Usuário não é gerência (verificação no modal)');
            return interaction.editReply({
                content: '❌ Apenas gerência pode criar encomendas!'
            });
        }
        
        // Buscar produtos disponíveis
        const { data: produtos, error } = await supabase
            .from('produtos')
            .select('*')
            .eq('ativo', true)
            .order('nome');
        
        if (error) {
            console.error('❌ Erro ao buscar produtos:', error);
            throw new Error('Erro ao buscar produtos disponíveis');
        }
        
        if (!produtos || produtos.length === 0) {
            console.log('⚠️ Nenhum produto disponível');
            return interaction.editReply({
                content: '❌ Nenhum produto disponível no momento!'
            });
        }
        
        console.log(`📦 ${produtos.length} produtos encontrados`);
        
        // Salvar dados temporários
        const dadosTemporarios = {
            clienteNome,
            observacoes,
            atendenteId: interaction.user.id,
            atendenteNome: interaction.user.username,
            dataCriacao: Date.now(),
            produtos: produtos.map(p => ({
                id: p.id,
                nome: p.nome,
                valor: p.valor_unitario,
                quantidade: 0
            }))
        };
        
        // Armazenar temporariamente com limpeza automática de antigos
        limparEncomendasAntigas();
        
        const tempId = Date.now().toString();
        global.encomendasTemporarias[tempId] = dadosTemporarios;
        
        console.log(`🆔 Encomenda temporária criada: ${tempId}`);
        
        // Criar menu de seleção de produtos
        const selectOptions = produtos.map(produto => ({
            label: produto.nome.length > 25 ? produto.nome.substring(0, 22) + '...' : produto.nome,
            description: `$${produto.valor_unitario.toLocaleString('pt-BR')} cada`,
            value: produto.id.toString(),
            emoji: getProdutoEmoji(produto.nome)
        }));
        
        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId(`selecionar_produto_${tempId}`)
            .setPlaceholder('Selecione um produto para adicionar')
            .addOptions(selectOptions);
        
        const row = new ActionRowBuilder().addComponents(selectMenu);
        
        const embed = new EmbedBuilder()
            .setTitle('🛒 NOVA ENCOMENDA')
            .setColor(0x3498DB)
            .addFields(
                { name: '👤 Cliente', value: clienteNome, inline: true },
                { name: '🛠️ Atendente', value: interaction.user.username, inline: true },
                { name: '📝 Observações', value: observacoes || 'Nenhuma', inline: false },
                { name: '⏰ Tempo limite', value: 'Esta sessão expira em 15 minutos', inline: true }
            )
            .setDescription('Selecione os produtos abaixo:')
            .setFooter({ text: `ID da sessão: ${tempId}` });
        
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
        
        console.log('✅ Modal processado com sucesso!');
        
    } catch (error) {
        console.error('❌ Erro ao processar modal de encomenda:', error);
        
        try {
            if (interaction.deferred) {
                await interaction.editReply({
                    content: `❌ Erro: ${error.message || 'Erro desconhecido'}`
                });
            } else {
                await interaction.reply({
                    content: `❌ Erro: ${error.message || 'Erro desconhecido'}`,
                    flags: MessageFlags.Ephemeral
                });
            }
        } catch (replyError) {
            console.error('❌ Não foi possível responder:', replyError);
        }
    }
}

// Modal para quantidade do produto
async function mostrarModalQuantidade(interaction, produtoId, tempId) {
    console.log(`📊 Mostrando modal de quantidade para produto ${produtoId}, temp ${tempId}`);
    
    try {
        if (!global.encomendasTemporarias || !global.encomendasTemporarias[tempId]) {
            console.log('⚠️ Sessão expirada');
            
            // Verificar se é uma sessão muito antiga
            if (global.encomendasTemporarias[tempId]) {
                const idade = Date.now() - global.encomendasTemporarias[tempId].dataCriacao;
                if (idade > 15 * 60 * 1000) { // 15 minutos
                    delete global.encomendasTemporarias[tempId];
                }
            }
            
            return interaction.reply({
                content: '❌ Sessão expirada! Por favor, inicie novamente.',
                flags: MessageFlags.Ephemeral
            });
        }
        
        const dados = global.encomendasTemporarias[tempId];
        const produto = dados.produtos.find(p => p.id == produtoId);
        
        if (!produto) {
            console.log('⚠️ Produto não encontrado');
            return interaction.reply({
                content: '❌ Produto não encontrado!',
                flags: MessageFlags.Ephemeral
            });
        }
        
        console.log(`📦 Produto: ${produto.nome}, Valor: $${produto.valor}`);
        
        const modal = new ModalBuilder()
            .setCustomId(`quantidade_modal_${produtoId}_${tempId}`)
            .setTitle(`Quantidade: ${produto.nome}`);
        
        const quantidadeInput = new TextInputBuilder()
            .setCustomId('quantidade_input')
            .setLabel(`Quantidade de ${produto.nome}`)
            .setStyle(TextInputStyle.Short)
            .setPlaceholder(`Digite a quantidade (Valor: $${produto.valor.toLocaleString('pt-BR')} cada)`)
            .setRequired(true)
            .setMaxLength(10);
        
        const linha = new ActionRowBuilder().addComponents(quantidadeInput);
        modal.addComponents(linha);
        
        await interaction.showModal(modal);
        console.log('✅ Modal de quantidade mostrado!');
        
    } catch (error) {
        console.error('❌ Erro ao mostrar modal de quantidade:', error);
        
        if (error.code === 40060) {
            console.log('⚠️ Interação já reconhecida');
            return;
        }
        
        try {
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                    content: '❌ Erro ao abrir formulário de quantidade. Tente novamente.',
                    flags: MessageFlags.Ephemeral
                });
            }
        } catch (replyError) {
            console.error('❌ Não foi possível responder:', replyError);
        }
    }
}

// Processar quantidade e atualizar carrinho
async function processarQuantidadeProduto(interaction) {
    console.log('📊 Processando quantidade...');
    
    try {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        
        const customIdParts = interaction.customId.split('_');
        const produtoId = customIdParts[2];
        const tempId = customIdParts[3];
        const quantidade = interaction.fields.getTextInputValue('quantidade_input');
        
        console.log(`🔢 Quantidade recebida: ${quantidade} para produto ${produtoId}, temp ${tempId}`);
        
        if (!global.encomendasTemporarias || !global.encomendasTemporarias[tempId]) {
            console.log('⚠️ Dados temporários não encontrados');
            return interaction.editReply({
                content: '❌ Sessão expirada! Por favor, inicie novamente.'
            });
        }
        
        const quantidadeNum = parseInt(quantidade);
        if (isNaN(quantidadeNum) || quantidadeNum <= 0) {
            console.log('⚠️ Quantidade inválida:', quantidade);
            return interaction.editReply({
                content: '❌ Quantidade inválida! Digite um número maior que 0.'
            });
        }
        
        if (quantidadeNum > 1000) {
            console.log('⚠️ Quantidade muito alta:', quantidadeNum);
            return interaction.editReply({
                content: '❌ Quantidade muito alta! Máximo: 1000 unidades.'
            });
        }
        
        // Atualizar quantidade
        const dados = global.encomendasTemporarias[tempId];
        const produtoIndex = dados.produtos.findIndex(p => p.id == produtoId);
        
        if (produtoIndex === -1) {
            console.log('⚠️ Índice do produto não encontrado');
            return interaction.editReply({
                content: '❌ Produto não encontrado!'
            });
        }
        
        dados.produtos[produtoIndex].quantidade = quantidadeNum;
        global.encomendasTemporarias[tempId] = dados;
        
        console.log(`✅ Produto atualizado: ${dados.produtos[produtoIndex].nome} x${quantidadeNum}`);
        
        // Calcular total
        const total = dados.produtos.reduce((sum, p) => sum + (p.valor * p.quantidade), 0);
        
        const embed = criarEmbedCarrinho(dados, total);
        
        await interaction.editReply({
            content: `✅ **${quantidadeNum} ${dados.produtos[produtoIndex].nome} adicionado(s)!**\n\nTotal atual: **$${total.toLocaleString('pt-BR')}**`,
            embeds: [embed]
        });
        
        console.log('✅ Quantidade processada com sucesso!');
        
    } catch (error) {
        console.error('❌ Erro ao processar quantidade:', error);
        
        try {
            if (interaction.deferred) {
                await interaction.editReply({
                    content: `❌ Erro: ${error.message || 'Erro ao processar quantidade'}`
                });
            }
        } catch (editError) {
            console.error('❌ Não foi possível editar resposta:', editError);
        }
    }
}

// Finalizar encomenda e enviar para canal de logs
async function finalizarEncomenda(interaction, tempId) {
    console.log(`✅ Finalizando encomenda temp: ${tempId}`);
    
    try {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        
        if (!global.encomendasTemporarias || !global.encomendasTemporarias[tempId]) {
            console.log('⚠️ Encomenda temporária não encontrada');
            return interaction.editReply({
                content: '❌ Sessão expirada! Por favor, inicie novamente.'
            });
        }
        
        const dados = global.encomendasTemporarias[tempId];
        const produtosSelecionados = dados.produtos.filter(p => p.quantidade > 0);
        
        if (produtosSelecionados.length === 0) {
            console.log('⚠️ Nenhum produto selecionado');
            return interaction.editReply({
                content: '❌ Nenhum produto selecionado!'
            });
        }
        
        const total = produtosSelecionados.reduce((sum, p) => sum + (p.valor * p.quantidade), 0);
        
        console.log(`💾 Salvando encomenda no banco...`);
        console.log(`👤 Cliente: ${dados.clienteNome}`);
        console.log(`💰 Total: $${total}`);
        console.log(`📦 Produtos: ${produtosSelecionados.length}`);
        
        // Salvar encomenda no banco
        const { data: encomenda, error: errorEncomenda } = await supabase
            .from('encomendas')
            .insert([{
                cliente_nome: dados.clienteNome,
                status: 'pendente',
                valor_total: total,
                atendente_id: dados.atendenteId,
                atendente_nome: dados.atendenteNome,
                observacoes: dados.observacoes,
                data_pedido: new Date().toISOString()
            }])
            .select()
            .single();
        
        if (errorEncomenda) {
            console.error('❌ Erro ao salvar encomenda:', errorEncomenda);
            throw new Error(`Erro ao salvar encomenda: ${errorEncomenda.message}`);
        }
        
        console.log(`✅ Encomenda salva com ID: ${encomenda.id}`);
        
        // Salvar itens da encomenda
        for (const produto of produtosSelecionados) {
            const { error: errorItem } = await supabase
                .from('encomenda_itens')
                .insert([{
                    encomenda_id: encomenda.id,
                    produto_id: produto.id,
                    produto_nome: produto.nome,
                    quantidade: produto.quantidade,
                    valor_unitario: produto.valor,
                    valor_total: produto.valor * produto.quantidade
                }]);
            
            if (errorItem) {
                console.error('❌ Erro ao salvar item:', errorItem);
            } else {
                console.log(`✅ Item salvo: ${produto.nome} x${produto.quantidade}`);
            }
        }
        
        // Limpar dados temporários
        delete global.encomendasTemporarias[tempId];
        
        // Enviar log para canal de logs
        await enviarLogEncomenda(interaction.client, encomenda, dados, produtosSelecionados, total);
        
        // Enviar confirmação
        await interaction.editReply({
            content: `✅ **ENCOMENDA #${encomenda.id} CRIADA COM SUCESSO!**\n\n📦 **ID:** #${encomenda.id}\n👤 **Cliente:** ${dados.clienteNome}\n💰 **Valor:** $${total.toLocaleString('pt-BR')}\n\nA encomenda foi registrada no sistema de logs.`
        });
        
        console.log('✅ Encomenda finalizada com sucesso!');
        
    } catch (error) {
        console.error('❌ Erro ao finalizar encomenda:', error);
        
        try {
            if (interaction.deferred) {
                await interaction.editReply({
                    content: `❌ Erro ao criar encomenda: ${error.message || 'Erro desconhecido'}`
                });
            }
        } catch (editError) {
            console.error('❌ Não foi possível editar resposta:', editError);
        }
    }
}

// Enviar log para canal de logs
async function enviarLogEncomenda(client, encomenda, dados, produtos, total) {
    try {
        const canalLogId = process.env.CANAL_LOG_ENCOMENDAS_ID;
        if (!canalLogId) {
            console.log('⚠️ Canal de log de encomendas não configurado.');
            return;
        }
        
        const canalLog = await client.channels.fetch(canalLogId);
        if (!canalLog) {
            console.log('⚠️ Canal de log não encontrado.');
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
                { name: '🛠️ Atendente', value: dados.atendenteNome, inline: true },
                { name: '📅 Data', value: new Date(encomenda.data_pedido).toLocaleString('pt-BR'), inline: true }
            )
            .setFooter({ text: `ID da Encomenda: ${encomenda.id}` })
            .setTimestamp();
        
        if (dados.observacoes) {
            embedLog.addFields({
                name: '📝 Observações',
                value: dados.observacoes,
                inline: false
            });
        }
        
        // Adicionar detalhes dos produtos
        let produtosText = '';
        produtos.forEach((produto) => {
            const subtotal = produto.valor * produto.quantidade;
            produtosText += `**${produto.nome}**\n`;
            produtosText += `• Quantidade: ${produto.quantidade} × $${produto.valor.toLocaleString('pt-BR')}\n`;
            produtosText += `• Subtotal: $${subtotal.toLocaleString('pt-BR')}\n\n`;
        });
        
        embedLog.addFields({
            name: '📋 Produtos Encomendados',
            value: produtosText || 'Nenhum produto selecionado',
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
                mensagem_log_id: mensagemLog.id,
                canal_log_id: canalLogId
            })
            .eq('id', encomenda.id);
        
        console.log(`✅ Log da encomenda #${encomenda.id} enviado para canal de logs`);
        
    } catch (error) {
        console.error('❌ Erro ao enviar log:', error);
    }
}

// Função para limpar encomendas antigas
function limparEncomendasAntigas() {
    if (!global.encomendasTemporarias) return;
    
    const agora = Date.now();
    const limite = 15 * 60 * 1000; // 15 minutos
    
    for (const [tempId, dados] of Object.entries(global.encomendasTemporarias)) {
        if (agora - dados.dataCriacao > limite) {
            delete global.encomendasTemporarias[tempId];
            console.log(`🧹 Encomenda temporária ${tempId} limpa (expirada)`);
        }
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
            { name: '📋 Itens', value: produtosSelecionados.length.toString(), inline: true },
            { name: '🛠️ Atendente', value: dados.atendenteNome, inline: true }
        )
        .setFooter({ text: 'Selecione mais produtos ou finalize a encomenda' })
        .setTimestamp();
    
    if (produtosSelecionados.length > 0) {
        let itensText = '';
        produtosSelecionados.forEach((produto) => {
            const subtotal = produto.valor * produto.quantidade;
            itensText += `**${produto.nome}**\n`;
            itensText += `• Quantidade: ${produto.quantidade} × $${produto.valor.toLocaleString('pt-BR')}\n`;
            itensText += `• Subtotal: $${subtotal.toLocaleString('pt-BR')}\n\n`;
        });
        
        embed.addFields({ name: '📦 Produtos Selecionados', value: itensText, inline: false });
    } else {
        embed.addFields({ name: '📦 Produtos Selecionados', value: 'Nenhum produto selecionado ainda.', inline: false });
    }
    
    return embed;
}

function getProdutoEmoji(nome) {
    const emojis = {
        'chip': '📱',
        'hacking': '💻',
        'pendrive': '💾',
        'usb': '💾',
        'jammer': '📡',
        'cartão': '💳',
        'cartao': '💳',
        'card': '💳',
        'criptografado': '💳'
    };
    
    const nomeLower = nome.toLowerCase();
    for (const [key, emoji] of Object.entries(emojis)) {
        if (nomeLower.includes(key)) {
            return emoji;
        }
    }
    
    return '📦';
}

module.exports = {
    enviarMenuEncomendas,
    processarModalEncomenda,
    mostrarModalQuantidade,
    processarQuantidadeProduto,
    finalizarEncomenda
};