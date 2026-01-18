const { Events, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const supabase = require('../database/supabase');
const { finalizarEncomendaHandler, cancelarEncomendaHandler, cancelarEncomendaLogHandler } = require('../utils/encomendaHandlers');
const { iniciarFarmSimples, processarModalFarmSimples } = require('../components/farmSimples');
const { registrarMembroModal, editarFarmModal, criarPastaFarm } = require('../components/registro');
const comprovanteHandler = require('../components/comprovanteDropdown');
const encomendaComponents = require('../components/encomendas');
const processedButtons = new Set();
const PROCESS_TIMEOUT = 10000; // 10 segundos

// Sistema de lock melhorado
const activeInteractions = new Map();

async function checkInteraction(interaction) {
    const key = `${interaction.id}_${interaction.user.id}_${interaction.customId || interaction.commandName}`;
    
    // Verificar se já está processando
    if (activeInteractions.has(key)) {
        console.log(`⚠️ Interação duplicada detectada: ${key}`);
        
        // Se já passou tempo suficiente, permitir nova tentativa
        const timestamp = activeInteractions.get(key);
        const now = Date.now();
        
        if (now - timestamp < 3000) { // 3 segundos
            console.log(`⏰ Interação muito recente, ignorando...`);
            return false;
        }
    }
    
    // Registrar nova interação
    activeInteractions.set(key, Date.now());
    
    // Limpar interações antigas automaticamente (após 30 segundos)
    setTimeout(() => {
        if (activeInteractions.has(key)) {
            activeInteractions.delete(key);
        }
    }, 30000);
    
    return true;
}

module.exports = {
    name: Events.InteractionCreate,
    async execute(interaction, client) {
        // Verificar se a interação ainda é válida
        if (!interaction.isCommand() && !interaction.isButton() && !interaction.isModalSubmit() && !interaction.isStringSelectMenu()) {
            console.log(`⚠️ Interação inválida ou expirada: ${interaction.type}`);
            return;
        }
        
        // Verificar se é uma interação duplicada
        if (!(await checkInteraction(interaction))) {
            return;
        }
        
        try {
            // Log simples
            console.log(`🔧 Tipo: ${interaction.type}, ID: ${interaction.customId || interaction.commandName || 'N/A'}`);
            
            // BOTÕES - SOLUÇÃO SIMPLIFICADA
            if (interaction.isButton()) {
                await handleButton(interaction, client);
                return;
            }
            
            // MODAIS
            if (interaction.isModalSubmit()) {
                await handleModal(interaction, client);
                return;
            }
            
            // MENUS DE SELEÇÃO
            if (interaction.isStringSelectMenu()) {
                await handleSelectMenu(interaction, client);
                return;
            }
            
            // COMANDOS SLASH
            if (interaction.isChatInputCommand()) {
                const command = client.commands.get(interaction.commandName);
                if (!command) {
                    console.log(`❌ Comando não encontrado: ${interaction.commandName}`);
                    return;
                }

                try {
                    await command.execute(interaction);
                } catch (error) {
                    console.error('Erro no comando:', error);
                    
                    // CORREÇÃO: Verificar se já foi respondido
                    if (!interaction.replied && !interaction.deferred) {
                        try {
                            await interaction.reply({
                                content: '❌ Erro ao executar comando!',
                                flags: 64
                            });
                        } catch (replyError) {
                            console.error('Não foi possível responder:', replyError.message);
                        }
                    } else {
                        console.log('⚠️ Interação já foi respondida, não é possível enviar nova resposta');
                    }
                }
                return;
            }
            
        } catch (error) {
            console.error('❌ Erro geral:', error);
        }
    },
};

// HANDLER DE BOTÕES
async function handleButton(interaction, client) {
    console.log(`🟢 Botão: ${interaction.customId}`);
    
    // 1. BOTÃO DE ENCOMENDA
    if (interaction.customId === 'iniciar_encomenda') {
        console.log('🎯 Iniciando encomenda...');
        
        // Verificar permissão
        const isGerencia = interaction.member.roles.cache.has(process.env.CARGO_GERENCIA_ID) || 
                          interaction.member.roles.cache.has(process.env.CARGO_LIDER_ID);
        
        if (!isGerencia) {
            try {
                await interaction.reply({
                    content: '❌ Apenas gerência pode criar encomendas!',
                    flags: 64
                });
            } catch (error) {
                console.error('Erro ao responder:', error.message);
            }
            return;
        }
        
        // CRIAR E MOSTRAR MODAL DIRETAMENTE
        try {
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
            console.log('✅ Modal mostrado!');
            
        } catch (error) {
            console.error('❌ Erro ao mostrar modal:', error.message);
            
            if (!interaction.replied) {
                try {
                    await interaction.reply({
                        content: '❌ Não foi possível abrir o formulário. Tente novamente.',
                        flags: 64
                    });
                } catch (replyError) {
                    console.error('Não foi possível responder:', replyError.message);
                }
            }
        }
        
        return;
    }
    
    // 2. BOTÃO DE REGISTRO
    if (interaction.customId === 'iniciar_registro') {
        await registrarMembroModal(interaction);
        return;
    }
    
    // 3. BOTÃO DE CRIAR PASTA FARM
    if (interaction.customId === 'criar_pasta_farm') {
        await criarPastaFarm(interaction);
        return;
    }
    
    // 4. BOTÃO DE FINALIZAR SELEÇÃO DE ENCOMENDA
    if (interaction.customId.startsWith('finalizar_selecao_')) {
        const tempId = interaction.customId.split('_')[2];
        await encomendaComponents.finalizarEncomenda(interaction, tempId);
        return;
    }
    
    // 5. BOTÃO DE CANCELAR ENCOMENDA TEMPORÁRIA
    if (interaction.customId.startsWith('cancelar_encomenda_temp_')) {
        const tempId = interaction.customId.split('_')[3];
        await cancelarEncomendaTemporaria(interaction, tempId);
        return;
    }
    
    // 6. BOTÃO DE FINALIZAR ENCOMENDA DO LOG
    if (interaction.customId.startsWith('finalizar_encomenda_')) {
        const encomendaId = interaction.customId.split('_')[2];
        await finalizarEncomendaHandler(interaction, encomendaId);
        return;
    }
    
    // 7. BOTÃO DE CANCELAR ENCOMENDA DO LOG
    if (interaction.customId.startsWith('cancelar_encomenda_log_')) {
        const encomendaId = interaction.customId.split('_')[3];
        await cancelarEncomendaLogHandler(interaction, encomendaId);
        return;
    }
    
    // 8. BOTÃO DE COMPROVANTE (ANTIGO - Manter compatibilidade)
    if (interaction.customId.startsWith('upload_comprovante_')) {
        // Verificar se é gerência
        const isGerencia = interaction.member.roles.cache.has(process.env.CARGO_GERENCIA_ID) || 
                          interaction.member.roles.cache.has(process.env.CARGO_LIDER_ID);
        
        if (!isGerencia) {
            return interaction.reply({
                content: '❌ Apenas gerência pode enviar comprovantes!',
                flags: 64
            });
        }
        
        await comprovanteHandler.mostrarModalComprovanteDropdown(interaction);
        return;
    }
    
    // 9. BOTÃO FECHAR FARM (NOVO)
    if (interaction.customId.startsWith('fechar_farm_')) {
        const customIdParts = interaction.customId.split('_');
        const semana = customIdParts[2];
        const ano = customIdParts[3];
        const canalId = customIdParts[4];
        // timestamp = customIdParts[5] // Não necessário para o processamento

        await fecharFarmHandler(interaction, semana, ano, canalId);
        return;
    }
    
    // 10. BOTÃO VER COMPROVANTES
    if (interaction.customId.startsWith('ver_comprovantes_')) {
        const membroId = interaction.customId.split('_')[2];
        await comprovanteHandler.verComprovantesMembro(interaction, membroId);
        return;
    }
    
    // 11. BOTÃO ENVIAR COMPROVANTE (GERAL) - No resumo do /fecharpastas
    if (interaction.customId.startsWith('enviar_comprovante_')) {
        const customIdParts = interaction.customId.split('_');
        const semana = customIdParts[2];
        const ano = customIdParts[3];
        
        await interaction.reply({
            content: `📎 **Use o botão "ENVIAR COMPROVANTE" nas pastas individuais dos membros.**\n\nVá até a pasta de cada membro que tem pagamento pendente e clique no botão "ENVIAR COMPROVANTE" que apareceu lá.`,
            flags: 64
        });
        return;
    }
    
    // 12. BOTÃO VER DETALHES
    if (interaction.customId.startsWith('ver_detalhes_')) {
        const customIdParts = interaction.customId.split('_');
        const semana = customIdParts[2];
        const ano = customIdParts[3];
        await comprovanteHandler.listarComprovantes(interaction, semana, ano);
        return;
    }
    
    // 13. BOTÃO GERAR PAGAMENTOS
    if (interaction.customId.startsWith('gerar_pagamentos_')) {
        await interaction.reply({
            content: '💰 **Os pagamentos já foram calculados no resumo!**\n\nConfira o arquivo anexado no comando `/fecharpastas` para ver os valores detalhados de cada membro.',
            flags: 64
        });
        return;
    }
    
    // 14. BOTÕES ANTIGOS (Manter compatibilidade)
    if (interaction.customId.startsWith('farm_pago_')) {
        const customIdParts = interaction.customId.split('_');
        const semana = customIdParts[2];
        const ano = customIdParts[3];
        
        await interaction.reply({
            content: `✅ **Farm da semana ${semana} marcado como pago!**\n\nO membro será notificado em breve.`,
            flags: 64
        });
        return;
    }
    
    if (interaction.customId.startsWith('confirmar_pagamento_')) {
        const customIdParts = interaction.customId.split('_');
        const semana = customIdParts[2];
        const ano = customIdParts[3];
        
        const embed = new EmbedBuilder()
            .setTitle(`✅ PAGAMENTO CONFIRMADO`)
            .setDescription(`Pagamento da semana ${semana} de ${ano} confirmado por ${interaction.user.username}`)
            .setColor(0x00FF00)
            .setTimestamp();
        
        await interaction.update({
            content: `✅ **PAGAMENTO CONFIRMADO!**\n\nA gerência deve enviar os comprovantes nas pastas individuais dos membros.`,
            embeds: [embed],
            components: []
        });
        return;
    }
    
    if (interaction.customId.startsWith('cancelar_pagamento_')) {
        await interaction.update({
            content: '❌ **Pagamento cancelado pela gerência.**',
            embeds: [],
            components: []
        });
        return;
    }
    
    // 15. BOTÕES DE LOG DE REGISTRO
    if (interaction.customId.startsWith('ver_membro_')) {
        const discordId = interaction.customId.split('_')[2];
        await verMembro(interaction, discordId);
        return;
    }
    
    if (interaction.customId.startsWith('promover_')) {
        const discordId = interaction.customId.split('_')[1];
        await promoverMembro(interaction, discordId);
        return;
    }
    
    console.log(`⚠️ Botão não tratado: ${interaction.customId}`);
}

// HANDLER DE MODAIS
async function handleModal(interaction, client) {
    console.log(`📋 Modal: ${interaction.customId}`);
    
    // 1. MODAL DE ENCOMENDA
    if (interaction.customId === 'encomenda_modal') {
        console.log('📦 Processando encomenda...');
        
        try {
            await interaction.deferReply({ flags: 64 });
            
            const clienteNome = interaction.fields.getTextInputValue('cliente_input');
            const observacoes = interaction.fields.getTextInputValue('observacoes_input') || '';
            
            console.log(`👤 Cliente: ${clienteNome}, 📝 Obs: ${observacoes || 'Nenhuma'}`);
            
            // Verificar se supabase está funcionando
            if (typeof supabase.from !== 'function') {
                throw new Error('Banco de dados não está disponível');
            }
            
            const { data: produtos, error } = await supabase
                .from('produtos')
                .select('*')
                .eq('ativo', true)
                .order('nome');
            
            if (error) {
                console.error('Erro Supabase:', error);
                throw error;
            }
            
            if (!produtos || produtos.length === 0) {
                await interaction.editReply({
                    content: '❌ Nenhum produto disponível no momento!'
                });
                return;
            }
            
            console.log(`📦 ${produtos.length} produtos encontrados`);
            
            if (!global.encomendasTemporarias) {
                global.encomendasTemporarias = {};
            }
            
            const tempId = Date.now().toString();
            global.encomendasTemporarias[tempId] = {
                clienteNome,
                observacoes,
                atendenteId: interaction.user.id,
                atendenteNome: interaction.user.username,
                produtos: produtos.map(p => ({
                    id: p.id,
                    nome: p.nome,
                    valor: p.valor_unitario,
                    quantidade: 0
                }))
            };
            
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
                    { name: '📝 Observações', value: observacoes || 'Nenhuma', inline: false }
                )
                .setDescription('Selecione os produtos abaixo:')
                .setFooter({ text: `Sessão: ${tempId}` });
            
            const botoes = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`finalizar_selecao_${tempId}`)
                        .setLabel('FINALIZAR')
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
                components: [row, botoes]
            });
            
            console.log('✅ Modal processado com sucesso!');
            
        } catch (error) {
            console.error('❌ Erro ao processar modal:', error);
            
            try {
                if (interaction.deferred) {
                    await interaction.editReply({
                        content: `❌ Erro: ${error.message || 'Erro ao processar encomenda'}`
                    });
                }
            } catch (editError) {
                console.error('Não foi possível editar resposta:', editError);
            }
        }
        
        return;
    }
    
    // 2. MODAL DE QUANTIDADE (para encomendas)
    if (interaction.customId.startsWith('quantidade_modal_')) {
        await handleQuantidadeModal(interaction);
        return;
    }
    
    // 3. MODAL DE REGISTRO DE MEMBRO
    if (interaction.customId === 'registro_membro_modal') {
        await processarRegistroMembro(interaction);
        return;
    }
    
    // 4. MODAL DE EDITAR FARM
    if (interaction.customId.startsWith('editar_farm_modal_')) {
        await processarEditarFarm(interaction);
        return;
    }
    
    // 5. MODAL DE FARM SIMPLES
    if (interaction.customId.startsWith('farm_modal_')) {
        await processarModalFarmSimples(interaction);
        return;
    }
    
    // 6. MODAL DE COMPROVANTE VIA DROPDOWN (NOVO)
    if (interaction.customId === 'modal_comprovante_dropdown') {
        await comprovanteHandler.processarModalComprovanteDropdown(interaction);
        return;
    }
    
    // 7. MODAL DE COMPROVANTE ANTIGO (Manter compatibilidade)
    if (interaction.customId.startsWith('modal_comprovante_')) {
        await comprovanteHandler.processarModalComprovante(interaction);
        return;
    }
    
    // 8. MODAL DE PROMOÇÃO
    if (interaction.customId.startsWith('promover_modal_')) {
        await processarPromocaoMembro(interaction);
        return;
    }
    
    console.log(`⚠️ Modal não tratado: ${interaction.customId}`);
}

// HANDLER DE MENUS DE SELEÇÃO
async function handleSelectMenu(interaction, client) {
    console.log(`📋 Menu: ${interaction.customId}`);
    
    // 1. MENU DE SELEÇÃO DE PRODUTO PARA ENCOMENDA
    if (interaction.customId.startsWith('selecionar_produto_')) {
        const tempId = interaction.customId.split('_')[2];
        const produtoId = interaction.values[0];
        
        console.log(`📦 Produto ${produtoId} selecionado na sessão ${tempId}`);
        
        if (!global.encomendasTemporarias || !global.encomendasTemporarias[tempId]) {
            await interaction.reply({
                content: '❌ Sessão expirada!',
                flags: 64
            });
            return;
        }
        
        const dados = global.encomendasTemporarias[tempId];
        const produto = dados.produtos.find(p => p.id == produtoId);
        
        if (!produto) {
            await interaction.reply({
                content: '❌ Produto não encontrado!',
                flags: 64
            });
            return;
        }
        
        // Criar modal para quantidade
        try {
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
            console.error('Erro ao mostrar modal de quantidade:', error);
            
            if (error.code === 40060) {
                return;
            }
            
            try {
                await interaction.reply({
                    content: '❌ Erro ao abrir formulário.',
                    flags: 64
                });
            } catch (replyError) {
                console.error('Não foi possível responder:', replyError);
            }
        }
        
        return;
    }
    
    // 2. MENU DE SELEÇÃO DE TIPO DE FARM COM OPÇÃO COMPROVANTE (NOVO)
    if (interaction.customId === 'selecionar_tipo_farm') {
        const selectedValue = interaction.values[0];
        
        console.log(`🔘 Opção selecionada: ${selectedValue}`);
        
        if (selectedValue === 'comprovante_pagamento') {
            // Verificar se é gerência
            const isGerencia = interaction.member.roles.cache.has(process.env.CARGO_GERENCIA_ID) || 
                              interaction.member.roles.cache.has(process.env.CARGO_LIDER_ID);
            
            if (!isGerencia) {
                return interaction.reply({
                    content: '❌ **Apenas gerência pode registrar comprovantes!**',
                    flags: 64
                });
            }
            
            await comprovanteHandler.mostrarModalComprovanteDropdown(interaction);
        } else {
            await iniciarFarmSimples(interaction);
        }
        return;
    }
    
    console.log(`⚠️ Menu não tratado: ${interaction.customId}`);
}

// FUNÇÕES AUXILIARES

async function handleQuantidadeModal(interaction) {
    console.log('📊 Processando quantidade...');
    
    try {
        await interaction.deferReply({ flags: 64 });
        
        const customIdParts = interaction.customId.split('_');
        const produtoId = customIdParts[2];
        const tempId = customIdParts[3];
        const quantidade = interaction.fields.getTextInputValue('quantidade_input');
        
        console.log(`🔢 Quantidade: ${quantidade} para produto ${produtoId}, sessão ${tempId}`);
        
        if (!global.encomendasTemporarias || !global.encomendasTemporarias[tempId]) {
            await interaction.editReply({
                content: '❌ Sessão expirada!'
            });
            return;
        }
        
        const quantidadeNum = parseInt(quantidade);
        if (isNaN(quantidadeNum) || quantidadeNum <= 0) {
            await interaction.editReply({
                content: '❌ Quantidade inválida! Digite um número maior que 0.'
            });
            return;
        }
        
        if (quantidadeNum > 1000) {
            await interaction.editReply({
                content: '❌ Quantidade muito alta! Máximo: 1000 unidades.'
            });
            return;
        }
        
        const dados = global.encomendasTemporarias[tempId];
        const produtoIndex = dados.produtos.findIndex(p => p.id == produtoId);
        
        if (produtoIndex === -1) {
            await interaction.editReply({
                content: '❌ Produto não encontrado!'
            });
            return;
        }
        
        dados.produtos[produtoIndex].quantidade = quantidadeNum;
        global.encomendasTemporarias[tempId] = dados;
        
        console.log(`✅ Atualizado: ${dados.produtos[produtoIndex].nome} x${quantidadeNum}`);
        
        const total = dados.produtos.reduce((sum, p) => sum + (p.valor * p.quantidade), 0);
        const produtosSelecionados = dados.produtos.filter(p => p.quantidade > 0);
        
        const embed = new EmbedBuilder()
            .setTitle('🛒 CARRINHO ATUALIZADO')
            .setColor(0xF1C40F)
            .addFields(
                { name: '👤 Cliente', value: dados.clienteNome, inline: true },
                { name: '💰 Total', value: `$${total.toLocaleString('pt-BR')}`, inline: true },
                { name: '📦 Itens', value: produtosSelecionados.length.toString(), inline: true }
            );
        
        if (produtosSelecionados.length > 0) {
            let itensText = '';
            produtosSelecionados.forEach((produto) => {
                const subtotal = produto.valor * produto.quantidade;
                itensText += `**${produto.nome}**\n`;
                itensText += `• ${produto.quantidade} × $${produto.valor.toLocaleString('pt-BR')}\n`;
                itensText += `• Subtotal: $${subtotal.toLocaleString('pt-BR')}\n\n`;
            });
            
            embed.addFields({ name: 'Produtos Selecionados', value: itensText, inline: false });
        }
        
        await interaction.editReply({
            content: `✅ **${quantidadeNum} ${dados.produtos[produtoIndex].nome} adicionado(s)!**`,
            embeds: [embed]
        });
        
    } catch (error) {
        console.error('❌ Erro ao processar quantidade:', error);
        
        try {
            if (interaction.deferred) {
                await interaction.editReply({
                    content: '❌ Erro ao processar quantidade'
                });
            }
        } catch (editError) {
            console.error('Não foi possível editar:', editError);
        }
    }
}

async function cancelarEncomendaTemporaria(interaction, tempId) {
    try {
        await interaction.deferReply({ flags: 64 });
        
        if (global.encomendasTemporarias && global.encomendasTemporarias[tempId]) {
            delete global.encomendasTemporarias[tempId];
        }
        
        await interaction.editReply({
            content: '❌ Encomenda cancelada!'
        });
        
    } catch (error) {
        console.error('❌ Erro ao cancelar encomenda temporária:', error);
        await interaction.editReply({
            content: '❌ Erro ao cancelar encomenda.'
        });
    }
}

// 🔧 FUNÇÃO CORRIGIDA: processarRegistroMembro (COM id_in_game e atribuição de cargo)
async function processarRegistroMembro(interaction) {
    try {
        // Verificar se a interação ainda é válida
        if (!interaction.isModalSubmit()) {
            console.log('⚠️ Interação de modal expirada');
            return;
        }
        
        await interaction.deferReply({ flags: 64 });
        
        const idInGame = interaction.fields.getTextInputValue('id_input');
        const nome = interaction.fields.getTextInputValue('nome_input');
        const telefone = interaction.fields.getTextInputValue('telefone_input');
        const recrutador = interaction.fields.getTextInputValue('recrutador_input');
        
        console.log(`📝 Registrando membro: ${nome} (ID In-Game: ${idInGame || 'Não informado'})`);
        
        // Verificar se supabase está funcionando
        if (typeof supabase.from !== 'function') {
            throw new Error('Banco de dados não está disponível');
        }
        
        // Verificar se já está registrado
        const { data: membroExistente, error: errorExistente } = await supabase
            .from('membros')
            .select('*')
            .eq('discord_id', interaction.user.id)
            .single();
        
        if (membroExistente) {
            return interaction.editReply({
                content: '❌ Você já está registrado!'
            });
        }
        
        // Validar e converter idInGame
        let idInGameNum = null;
        if (idInGame && idInGame.trim() !== '') {
            idInGameNum = parseInt(idInGame);
            if (isNaN(idInGameNum)) {
                return interaction.editReply({
                    content: '❌ ID In-Game inválido! Deve ser um número.'
                });
            }
        }
        
        // Criar objeto de dados COM id_in_game
        const dadosRegistro = {
            discord_id: interaction.user.id,
            nome: nome,
            telefone: telefone || null,
            recrutador: recrutador || null,
            hierarquia: 'Membro',
            ativo: true,
            id_in_game: idInGameNum,
            cargo_id: process.env.CARGO_MEMBRO_ID
        };
        
        console.log('📊 Dados a serem inseridos:', dadosRegistro);
        
        // Inserir no banco
        const { data: membro, error } = await supabase
            .from('membros')
            .insert([dadosRegistro])
            .select()
            .single();
        
        if (error) {
            console.error('❌ Erro ao registrar membro:', error);
            
            // Tentar sem id_in_game se der erro (fallback)
            delete dadosRegistro.id_in_game;
            const { data: membro2, error: error2 } = await supabase
                .from('membros')
                .insert([dadosRegistro])
                .select()
                .single();
                
            if (error2) {
                throw new Error(`Erro de banco de dados: ${error2.message}`);
            }
            
            membro = membro2;
        }
        
        // 1. ATRIBUIR CARGO DE MEMBRO NO DISCORD
        try {
            const guild = await interaction.client.guilds.fetch(process.env.GUILD_ID);
            const member = await guild.members.fetch(interaction.user.id);
            const cargoMembro = await guild.roles.fetch(process.env.CARGO_MEMBRO_ID);
            
            if (cargoMembro) {
                await member.roles.add(cargoMembro.id);
                console.log(`✅ Cargo de membro atribuído a ${member.user.tag}`);
            }
            
            // 2. ATUALIZAR NICKNAME (se o membro tiver permissão)
            const novoNickname = `${nome} - ${idInGameNum || 'ID'}`;
            try {
                await member.setNickname(novoNickname);
                console.log(`✅ Nickname atualizado para: ${novoNickname}`);
            } catch (nickError) {
                console.log(`⚠️ Não foi possível atualizar nickname: ${nickError.message}`);
            }
            
        } catch (discordError) {
            console.error('❌ Erro ao atribuir cargo/mudar nickname:', discordError.message);
        }
        
        // 3. ENVIAR LOG PARA CANAL DE REGISTRO
        await enviarLogRegistro(interaction.client, membro, interaction.user, idInGameNum);
        
        // Criar embed de confirmação
        const embed = new EmbedBuilder()
            .setTitle('✅ REGISTRO CONCLUÍDO')
            .setColor(0x00FF00)
            .addFields(
                { name: '👤 Nome', value: nome, inline: true },
                { name: '📱 Telefone', value: telefone || 'Não informado', inline: true },
                { name: '🎯 Recrutador', value: recrutador || 'Não informado', inline: true },
                { name: '📊 Hierarquia', value: 'Membro', inline: true },
                { name: '📅 Data', value: new Date().toLocaleDateString('pt-BR'), inline: true },
                { name: '🎫 Cargo', value: '✅ Atribuído', inline: true }
            )
            .setFooter({ text: 'Bem-vindo à facção!' })
            .setTimestamp();
        
        // Mostrar ID In-Game se foi informado
        if (idInGameNum) {
            embed.addFields({ 
                name: '🆔 ID In-Game', 
                value: idInGameNum.toString(), 
                inline: true 
            });
        }
        
        await interaction.editReply({
            content: `✅ **Registro concluído com sucesso, ${nome}!**\n\n• Cargo "Membro" atribuído ✅\n• Nickname atualizado ✅\n• Log registrado ✅\n\nAgora você pode criar sua pasta farm.`,
            embeds: [embed]
        });
        
        console.log(`✅ Membro registrado: ${nome} (ID In-Game: ${idInGameNum || 'N/A'})`);
        
    } catch (error) {
        console.error('❌ Erro ao processar registro:', error);
        
        try {
            // Tentar responder mesmo com erro
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({
                    content: `❌ Erro ao registrar: ${error.message}\n\nContate a administração.`
                });
            } else {
                await interaction.reply({
                    content: `❌ Erro ao registrar: ${error.message}\n\nContate a administração.`,
                    flags: 64
                });
            }
        } catch (replyError) {
            console.error('❌ Não foi possível responder ao erro:', replyError.message);
        }
    }
}

// Função para enviar log de registro para canal específico
async function enviarLogRegistro(client, membro, usuarioDiscord, idInGame) {
    try {
        const canalLogId = process.env.CANAL_LOG_REGISTROS_ID;
        if (!canalLogId) {
            console.log('⚠️ Canal de log de registros não configurado.');
            return;
        }
        
        const guild = await client.guilds.fetch(process.env.GUILD_ID);
        const canalLog = await guild.channels.fetch(canalLogId);
        
        if (!canalLog) {
            console.log('⚠️ Canal de log de registros não encontrado.');
            return;
        }
        
        // Buscar informações do membro no servidor
        let memberDiscord;
        try {
            memberDiscord = await guild.members.fetch(membro.discord_id);
        } catch (error) {
            console.log('⚠️ Membro não encontrado no servidor (ainda):', error.message);
        }
        
        // Criar embed detalhado
        const embedLog = new EmbedBuilder()
            .setTitle('📋 NOVO MEMBRO REGISTRADO')
            .setColor(0x00AE86)
            .setThumbnail(usuarioDiscord.displayAvatarURL())
            .addFields(
                { name: '👤 Nome', value: membro.nome, inline: true },
                { name: '🆔 ID In-Game', value: idInGame ? idInGame.toString() : 'Não informado', inline: true },
                { name: '📱 Telefone', value: membro.telefone || 'Não informado', inline: true },
                { name: '🎯 Recrutador', value: membro.recrutador || 'Não informado', inline: true },
                { name: '📊 Hierarquia', value: membro.hierarquia || 'Membro', inline: true },
                { name: '🆔 Discord ID', value: membro.discord_id, inline: true },
                { name: '📅 Data de Registro', value: new Date().toLocaleString('pt-BR'), inline: true },
                { name: '🛠️ Registrado por', value: usuarioDiscord.username, inline: true }
            )
            .setFooter({ text: `ID do Banco: ${membro.id}` })
            .setTimestamp();
        
        // Adicionar informações do Discord se disponíveis
        if (memberDiscord) {
            embedLog.addFields(
                { name: '📅 Entrou no Discord', value: new Date(memberDiscord.joinedAt).toLocaleDateString('pt-BR'), inline: true },
                { name: '🎫 Cargo Atribuído', value: '✅ Membro', inline: true },
                { name: '👥 Cargos no Discord', value: memberDiscord.roles.cache.size > 1 ? 
                    memberDiscord.roles.cache.filter(r => r.id !== guild.id).map(r => r.name).join(', ') : 'Nenhum cargo adicional', 
                    inline: false }
            );
            
            // Verificar se nickname foi atualizado
            if (memberDiscord.nickname) {
                embedLog.addFields({ name: '🏷️ Nickname', value: memberDiscord.nickname, inline: true });
            }
        }
        
        // Botões de ação rápida
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
            embeds: [embedLog],
            components: [botoesLog]
        });
        
        console.log(`✅ Log de registro enviado para canal ${canalLog.name}: ${membro.nome}`);
        
        // Salvar log no banco de dados
        try {
            await supabase
                .from('logs_registro')
                .insert([
                    {
                        membro_id: membro.id,
                        discord_id: membro.discord_id,
                        nome: membro.nome,
                        telefone: membro.telefone || null,
                        recrutador: membro.recrutador || null,
                        hierarquia: membro.hierarquia || 'Membro',
                        registrado_por: usuarioDiscord.id,
                        tipo_acao: 'registro'
                    }
                ]);
            console.log('✅ Log salvo no banco de dados');
        } catch (logError) {
            console.log('⚠️ Não foi possível salvar log no banco:', logError.message);
        }
        
    } catch (error) {
        console.error('❌ Erro ao enviar log de registro:', error);
    }
}

async function processarEditarFarm(interaction) {
    try {
        await interaction.deferReply({ flags: 64 });
        
        const customIdParts = interaction.customId.split('_');
        const farmId = customIdParts[3];
        const quantidade = interaction.fields.getTextInputValue('quantidade_input');
        
        const quantidadeNum = parseInt(quantidade);
        if (isNaN(quantidadeNum) || quantidadeNum <= 0) {
            return interaction.editReply({
                content: '❌ Quantidade inválida! Digite um número maior que 0.'
            });
        }
        
        const { error } = await supabase
            .from('farm_semanal')
            .update({ quantidade: quantidadeNum })
            .eq('id', farmId);
        
        if (error) throw error;
        
        await interaction.editReply({
            content: `✅ Farm atualizado para ${quantidadeNum.toLocaleString('pt-BR')}!`
        });
        
    } catch (error) {
        console.error('❌ Erro ao editar farm:', error);
        await interaction.editReply({
            content: `❌ Erro: ${error.message}`
        });
    }
}

// 🔧 FUNÇÃO CORRIGIDA: verMembro (COM id_in_game)
async function verMembro(interaction, discordId) {
    try {
        await interaction.deferReply({ flags: 64 });
        
        const { data: membro, error } = await supabase
            .from('membros')
            .select('*')
            .eq('discord_id', discordId)
            .single();
        
        if (error || !membro) {
            return interaction.editReply({
                content: '❌ Membro não encontrado!'
            });
        }
        
        const embed = new EmbedBuilder()
            .setTitle(`👤 PERFIL - ${membro.nome}`)
            .setColor(0x3498DB)
            .addFields(
                { name: '🆔 ID In-Game', value: membro.id_in_game ? membro.id_in_game.toString() : 'Não informado', inline: true },
                { name: '📱 Telefone', value: membro.telefone || 'Não informado', inline: true },
                { name: '🎯 Recrutador', value: membro.recrutador || 'Não informado', inline: true },
                { name: '📊 Hierarquia', value: membro.hierarquia || 'Membro', inline: true },
                { name: '📅 Data de Registro', value: new Date(membro.data_registro).toLocaleDateString('pt-BR'), inline: true },
                { name: '✅ Status', value: membro.ativo ? 'Ativo' : 'Inativo', inline: true },
                { name: '🆔 Discord ID', value: membro.discord_id, inline: true }
            )
            .setFooter({ text: `ID do Membro: ${membro.id}` })
            .setTimestamp();
        
        await interaction.editReply({
            embeds: [embed]
        });
        
    } catch (error) {
        console.error('❌ Erro ao ver membro:', error);
        await interaction.editReply({
            content: `❌ Erro: ${error.message}`
        });
    }
}

async function promoverMembro(interaction, discordId) {
    try {
        await interaction.deferReply({ flags: 64 });
        
        // Verificar permissão
        const isGerencia = interaction.member.roles.cache.has(process.env.CARGO_GERENCIA_ID) || 
                          interaction.member.roles.cache.has(process.env.CARGO_LIDER_ID);
        
        if (!isGerencia) {
            return interaction.editReply({
                content: '❌ Apenas gerência pode promover membros!'
            });
        }
        
        // Buscar membro
        const { data: membro, error } = await supabase
            .from('membros')
            .select('*')
            .eq('discord_id', discordId)
            .single();
        
        if (error || !membro) {
            return interaction.editReply({
                content: '❌ Membro não encontrado!'
            });
        }
        
        // Criar modal para promoção
        const modal = new ModalBuilder()
            .setCustomId(`promover_modal_${discordId}`)
            .setTitle(`Promover ${membro.nome}`);
        
        const hierarquiaInput = new TextInputBuilder()
            .setCustomId('hierarquia_input')
            .setLabel("Nova Hierarquia")
            .setStyle(TextInputStyle.Short)
            .setPlaceholder("Ex: Trainee, Membro, Gerente, Líder")
            .setRequired(true)
            .setMaxLength(50);
        
        const motivoInput = new TextInputBuilder()
            .setCustomId('motivo_input')
            .setLabel("Motivo da Promoção")
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder("Descreva o motivo da promoção...")
            .setRequired(true)
            .setMaxLength(500);
        
        const primeiraLinha = new ActionRowBuilder().addComponents(hierarquiaInput);
        const segundaLinha = new ActionRowBuilder().addComponents(motivoInput);
        
        modal.addComponents(primeiraLinha, segundaLinha);
        
        await interaction.showModal(modal);
        
    } catch (error) {
        console.error('❌ Erro ao promover membro:', error);
        await interaction.editReply({
            content: `❌ Erro: ${error.message}`
        });
    }
}

async function processarPromocaoMembro(interaction) {
    try {
        await interaction.deferReply({ flags: 64 });
        
        const customIdParts = interaction.customId.split('_');
        const discordId = customIdParts[2];
        const novaHierarquia = interaction.fields.getTextInputValue('hierarquia_input');
        const motivo = interaction.fields.getTextInputValue('motivo_input');
        
        // Atualizar membro no banco
        const { error } = await supabase
            .from('membros')
            .update({ 
                hierarquia: novaHierarquia,
                updated_at: new Date().toISOString()
            })
            .eq('discord_id', discordId);
        
        if (error) throw error;
        
        // Buscar dados atualizados do membro
        const { data: membro } = await supabase
            .from('membros')
            .select('nome')
            .eq('discord_id', discordId)
            .single();
        
        const embed = new EmbedBuilder()
            .setTitle(`⬆️ MEMBRO PROMOVIDO`)
            .setColor(0x9B59B6)
            .addFields(
                { name: '👤 Membro', value: membro?.nome || 'Desconhecido', inline: true },
                { name: '📊 Nova Hierarquia', value: novaHierarquia, inline: true },
                { name: '🛠️ Promovido por', value: interaction.user.username, inline: true },
                { name: '📝 Motivo', value: motivo, inline: false }
            )
            .setFooter({ text: `Discord ID: ${discordId}` })
            .setTimestamp();
        
        await interaction.editReply({
            content: `✅ **${membro?.nome || 'Membro'} foi promovido para ${novaHierarquia}!**`,
            embeds: [embed]
        });
        
        // Atualizar cargo no Discord se configurado
        try {
            const guild = await interaction.client.guilds.fetch(process.env.GUILD_ID);
            const member = await guild.members.fetch(discordId);
            
            // Remover cargo antigo de membro
            const cargoMembro = await guild.roles.fetch(process.env.CARGO_MEMBRO_ID);
            if (cargoMembro && member.roles.cache.has(cargoMembro.id)) {
                await member.roles.remove(cargoMembro.id);
            }
            
            // Adicionar cargo apropriado baseado na hierarquia
            if (novaHierarquia.toLowerCase().includes('gerente') || novaHierarquia.toLowerCase().includes('gerência')) {
                const cargoGerencia = await guild.roles.fetch(process.env.CARGO_GERENCIA_ID);
                if (cargoGerencia) {
                    await member.roles.add(cargoGerencia.id);
                }
            } else if (novaHierarquia.toLowerCase().includes('líder') || novaHierarquia.toLowerCase().includes('lider')) {
                const cargoLider = await guild.roles.fetch(process.env.CARGO_LIDER_ID);
                if (cargoLider) {
                    await member.roles.add(cargoLider.id);
                }
            }
            
            console.log(`✅ Cargos atualizados para ${membro?.nome}`);
            
        } catch (discordError) {
            console.log('⚠️ Não foi possível atualizar cargos no Discord:', discordError.message);
        }
        
    } catch (error) {
        console.error('❌ Erro ao processar promoção:', error);
        await interaction.editReply({
            content: `❌ Erro: ${error.message}`
        });
    }
}

// Função auxiliar para emoji de produto
function getProdutoEmoji(nome) {
    const nomeLower = nome.toLowerCase();
    if (nomeLower.includes('chip')) return '📱';
    if (nomeLower.includes('hack')) return '💻';
    if (nomeLower.includes('pendrive') || nomeLower.includes('usb')) return '💾';
    if (nomeLower.includes('jammer')) return '📡';
    if (nomeLower.includes('cartão') || nomeLower.includes('cartao')) return '💳';
    return '📦';
}

async function fecharFarmHandler(interaction, semana, ano, canalId) {
    const buttonId = `${interaction.id}_${interaction.user.id}`;
    
    // Verificar se já processou este botão recentemente
    if (!canProcessButton(buttonId)) {
        console.log(`⏰ Ignorando clique duplicado no botão: ${buttonId}`);
        
        // Remover botões mesmo assim para evitar múltiplos cliques
        try {
            await interaction.message.edit({
                components: []
            });
        } catch (error) {
            // Ignorar erro
        }
        return;
    }
    
    console.log(`🔒 Tentando fechar farm: semana ${semana}, ano ${ano}, canal ${canalId}`);
    
    try {
        // Verificar se é gerência
        const isGerencia = interaction.member.roles.cache.has(process.env.CARGO_GERENCIA_ID) || 
                           interaction.member.roles.cache.has(process.env.CARGO_LIDER_ID);
        
        if (!isGerencia) {
            // Enviar mensagem direta no canal se não conseguir responder à interação
            try {
                await interaction.reply({
                    content: '❌ Apenas gerência pode fechar farms!',
                    flags: 64
                });
            } catch (replyError) {
                console.log('⚠️ Não foi possível responder, enviando mensagem no canal...');
                await interaction.channel.send({
                    content: `❌ <@${interaction.user.id}> Apenas gerência pode fechar farms!`,
                    flags: 64
                });
            }
            return;
        }
        
        // ATUALIZAR IMEDIATAMENTO - remover botões da mensagem original
        try {
            await interaction.message.edit({
                components: []
            });
            console.log('✅ Botões removidos da mensagem original');
        } catch (editError) {
            console.log('⚠️ Não foi possível remover botões:', editError.message);
        }
        
        // ENVIAR MENSAGEM DE PROCESSAMENTO
        let mensagemProcessando;
        try {
            mensagemProcessando = await interaction.reply({
                content: '⏳ **Processando fechamento de farm...**',
                flags: 64,
                fetchReply: true
            });
            console.log('✅ Mensagem de processamento enviada');
        } catch (replyError) {
            console.log('⚠️ Não foi possível responder, continuando processamento...');
            // Continuar mesmo sem resposta
        }
        
        // Buscar informações da pasta
        const { data: pasta, error: pastaError } = await supabase
            .from('pastas_farm')
            .select(`
                id,
                membros (
                    nome
                )
            `)
            .eq('canal_id', canalId)
            .single();
        
        if (pastaError || !pasta) {
            console.log('❌ Pasta farm não encontrada:', pastaError?.message || 'Sem dados');
            
            if (mensagemProcessando) {
                await mensagemProcessando.edit({
                    content: '❌ Pasta farm não encontrada!'
                });
            } else {
                await interaction.channel.send({
                    content: '❌ Pasta farm não encontrada!',
                    flags: 64
                });
            }
            return;
        }
        
        console.log(`✅ Pasta encontrada para membro: ${pasta.membros?.nome}`);
        
        // Marcar como fechada
        const { error: updateError } = await supabase
            .from('pastas_farm')
            .update({ 
                ativa: false,
                semana_fechada: semana,
                ano_fechada: ano,
                fechado_por: interaction.user.id,
                fechado_em: new Date().toISOString()
            })
            .eq('canal_id', canalId);
        
        if (updateError) {
            console.error('❌ Erro ao fechar pasta:', updateError);
            
            if (mensagemProcessando) {
                await mensagemProcessando.edit({
                    content: '❌ Erro ao fechar pasta farm no banco de dados.'
                });
            } else {
                await interaction.channel.send({
                    content: '❌ Erro ao fechar pasta farm no banco de dados.',
                    flags: 64
                });
            }
            return;
        }
        
        console.log('✅ Pasta atualizada no banco');
        
        const embed = new EmbedBuilder()
            .setTitle('🔒 FARM FECHADO')
            .setColor(0x00FF00)
            .setDescription(`**Farm da semana ${semana} de ${ano} foi oficialmente fechado e pago!**`)
            .addFields(
                { name: '👤 Membro', value: pasta.membros?.nome || 'Desconhecido', inline: true },
                { name: '📅 Semana', value: `${semana}/${ano}`, inline: true },
                { name: '🛠️ Fechado por', value: interaction.user.username, inline: true },
                { name: '✅ Status', value: 'Pagamento confirmado', inline: true }
            )
            .setFooter({ text: 'Farm marcado como fechado e pago' })
            .setTimestamp();
        
        console.log('✅ Embed criado');
        
        // Atualizar mensagem ou enviar nova
        if (mensagemProcessando) {
            await mensagemProcessando.edit({
                content: `✅ **Farm de ${pasta.membros?.nome || 'membro'} fechado com sucesso!**\n\nO pagamento foi registrado e a pasta foi marcada como fechada.`,
                embeds: [embed]
            });
        } else {
            await interaction.channel.send({
                content: `✅ **Farm de ${pasta.membros?.nome || 'membro'} fechado com sucesso!**\n\nO pagamento foi registrado e a pasta foi marcada como fechada.`,
                embeds: [embed],
                flags: 64
            });
        }
        
        console.log(`✅ Farm fechado com sucesso para ${pasta.membros?.nome}`);
        
    } catch (channelError) {
        console.error('❌ Não foi possível enviar mensagem de erro:', channelError.message);
    }
}

function canProcessButton(interactionId) {
    if (processedButtons.has(interactionId)) {
        console.log(`⏰ Botão ${interactionId} já processado recentemente`);
        return false;
    }
    
    processedButtons.add(interactionId);
    
    // Remover após timeout
    setTimeout(() => {
        processedButtons.delete(interactionId);
    }, PROCESS_TIMEOUT);
    
    return true;
}