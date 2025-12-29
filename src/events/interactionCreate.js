const { Events, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const supabase = require('../database/supabase');
const { registrarMembroModal, editarFarmModal, criarPastaFarm } = require('../components/registro');
const { iniciarFarmSimples, processarModalFarmSimples } = require('../components/farmSimples');
const { registrarLogMembro, enviarLogRegistroDiscord } = require('../utils/registroLogger');
const { resetarFarmsPagados, criarRegistroReset } = require('../utils/resetFarms');
const { 
    enviarMenuEncomendas, 
    iniciarEncomendaModal, 
    processarModalEncomenda, 
    mostrarModalQuantidade, 
    processarQuantidadeProduto, 
    finalizarEncomenda 
} = require('../components/encomendas');
const { 
    finalizarEncomendaHandler, 
    cancelarEncomendaHandler,
    cancelarEncomendaLogHandler 
} = require('../utils/encomendaHandlers');

module.exports = {
    name: Events.InteractionCreate,
    async execute(interaction, client) {
        // Log para debug
        console.log(`🔧 Interação recebida: ${interaction.type} | ${interaction.customId || interaction.commandName || 'N/A'}`);
        
        // Comandos slash
        if (interaction.isChatInputCommand()) {
            const command = client.commands.get(interaction.commandName);
            if (!command) return;

            try {
                await command.execute(interaction);
            } catch (error) {
                console.error(error);
                await interaction.reply({
                    content: '❌ Ocorreu um erro ao executar este comando!',
                    flags: 64
                });
            }
        }
        
        // Botões
        else if (interaction.isButton()) {
            // Botão de iniciar registro
            if (interaction.customId === 'iniciar_registro') {
                await registrarMembroModal(interaction);
            }
            
            // Botão de criar pasta farm
            else if (interaction.customId === 'criar_pasta_farm') {
                await criarPastaFarm(interaction);
            }
            
            // Botão de iniciar encomenda
            else if (interaction.customId === 'iniciar_encomenda') {
                await iniciarEncomendaModal(interaction);
            }
            
            // ✅ Botão "Farm Pago" nas pastas individuais
            else if (interaction.customId.startsWith('farm_pago_')) {
                // Botão "Farm Pago" - apenas gerência pode usar
                const cargosGerencia = [process.env.CARGO_GERENCIA_ID, process.env.CARGO_LIDER_ID];
                const temPermissao = interaction.member.roles.cache.some(role => cargosGerencia.includes(role.id));
                
                if (!temPermissao) {
                    return interaction.reply({
                        content: '❌ Apenas gerência pode marcar farm como pago!',
                        flags: 64
                    });
                }
                
                const partes = interaction.customId.split('_');
                const semana = partes[2];
                const ano = partes[3];
                
                console.log(`💰 Farm marcado como pago por ${interaction.user.tag} - Semana ${semana}/${ano}`);
                
                // 1. Atualizar a mensagem original
                await interaction.update({
                    content: `⏳ **PROCESSANDO PAGAMENTO...**\n\n💰 Pagamento da semana ${semana} de ${ano} está sendo processado por ${interaction.user.username}.`,
                    embeds: [],
                    components: []
                });
                
                // 2. Registrar no banco e RESETAR farms
                try {
                    // Primeiro, atualizar a tabela semanas_farm
                    await supabase
                        .from('semanas_farm')
                        .update({ 
                            pago: true,
                            pago_por: interaction.user.id,
                            pago_em: new Date().toISOString()
                        })
                        .eq('semana_numero', semana)
                        .eq('ano', ano);
                    
                    console.log(`✅ Pagamento registrado no banco para semana ${semana}/${ano}`);
                    
                    // 3. RESETAR os farms de dinheiro sujo para 0
                    const resultadoReset = await resetarFarmsPagados(semana, ano, interaction.user.id);
                    
                    if (resultadoReset.success) {
                        // 4. Criar registro de reset para histórico
                        await criarRegistroReset(semana, ano, interaction.user.id, resultadoReset.farmsResetados || 0);
                        
                        // 5. Atualizar a mensagem com confirmação completa
                        await interaction.editReply({
                            content: `✅ **FARM PAGO E RESETADO COM SUCESSO!**\n\n💰 Pagamento da semana ${semana} de ${ano} confirmado por ${interaction.user.username}.\n🔄 ${resultadoReset.farmsResetados || 0} farms de dinheiro sujo foram resetados para 0.\n\n✅ Pronto para a próxima semana!`,
                            embeds: [],
                            components: []
                        });
                        
                        console.log(`✅ Pagamento e reset concluídos para semana ${semana}/${ano}`);
                    } else {
                        // Se houver erro no reset, enviar mensagem de erro
                        await interaction.editReply({
                            content: `⚠️ **PAGAMENTO CONFIRMADO, MAS ERRO NO RESET**\n\n💰 Pagamento da semana ${semana} de ${ano} confirmado por ${interaction.user.username}.\n❌ Erro ao resetar farms: ${resultadoReset.error || 'Erro desconhecido'}`,
                            embeds: [],
                            components: []
                        });
                    }
                    
                } catch (error) {
                    console.error('❌ Erro ao processar pagamento:', error);
                    await interaction.editReply({
                        content: `❌ **ERRO AO PROCESSAR PAGAMENTO**\n\nErro ao processar pagamento da semana ${semana} de ${ano}:\n\`\`\`${error.message || 'Erro desconhecido'}\`\`\``,
                        embeds: [],
                        components: []
                    });
                }
            }
            
            // ✅ Botão "Confirmar Pagamento" no sistema de controle
            else if (interaction.customId.startsWith('confirmar_pagamento_')) {
                // Confirmar pagamento (apenas gerência)
                const cargosGerencia = [process.env.CARGO_GERENCIA_ID, process.env.CARGO_LIDER_ID];
                const temPermissao = interaction.member.roles.cache.some(role => cargosGerencia.includes(role.id));
                
                if (!temPermissao) {
                    return interaction.reply({
                        content: '❌ Apenas gerência pode confirmar pagamentos!',
                        flags: 64
                    });
                }
                
                const partes = interaction.customId.split('_');
                const semana = partes[2];
                const ano = partes[3];
                
                console.log(`✅ Pagamento confirmado por ${interaction.user.tag} - Semana ${semana}/${ano}`);
                
                await interaction.update({
                    content: `⏳ **PROCESSANDO PAGAMENTO E RESET...**\n\n💰 Pagamento da semana ${semana} de ${ano} está sendo processado por ${interaction.user.username}.`,
                    embeds: [],
                    components: []
                });
                
                // Registrar no banco e RESETAR farms
                try {
                    // Atualizar a tabela semanas_farm
                    await supabase
                        .from('semanas_farm')
                        .update({ 
                            pago: true,
                            pago_por: interaction.user.id,
                            pago_em: new Date().toISOString()
                        })
                        .eq('semana_numero', semana)
                        .eq('ano', ano);
                    
                    console.log(`✅ Confirmação de pagamento registrada no banco`);
                    
                    // RESETAR os farms de dinheiro sujo para 0
                    const resultadoReset = await resetarFarmsPagados(semana, ano, interaction.user.id);
                    
                    if (resultadoReset.success) {
                        // Criar registro de reset para histórico
                        await criarRegistroReset(semana, ano, interaction.user.id, resultadoReset.farmsResetados || 0);
                        
                        await interaction.editReply({
                            content: `✅ **PAGAMENTO CONFIRMADO E RESETADO!**\n\n💰 Pagamento da semana ${semana} de ${ano} confirmado por ${interaction.user.username}.\n🔄 ${resultadoReset.farmsResetados || 0} farms de dinheiro sujo foram resetados para 0.\n\n✅ Pronto para a próxima semana!`,
                            embeds: [],
                            components: []
                        });
                    } else {
                        await interaction.editReply({
                            content: `⚠️ **PAGAMENTO CONFIRMADO, MAS ERRO NO RESET**\n\n💰 Pagamento da semana ${semana} de ${ano} confirmado por ${interaction.user.username}.\n❌ Erro ao resetar farms: ${resultadoReset.error || 'Erro desconhecido'}`,
                            embeds: [],
                            components: []
                        });
                    }
                    
                } catch (error) {
                    console.error('❌ Erro ao registrar confirmação:', error);
                    await interaction.editReply({
                        content: `❌ **ERRO AO PROCESSAR PAGAMENTO**\n\nErro ao processar pagamento da semana ${semana} de ${ano}:\n\`\`\`${error.message || 'Erro desconhecido'}\`\`\``,
                        embeds: [],
                        components: []
                    });
                }
            }
            
            // ✅ Botão "Cancelar Pagamento" no sistema de controle
            else if (interaction.customId.startsWith('cancelar_pagamento_')) {
                // Cancelar pagamento (apenas gerência)
                const cargosGerencia = [process.env.CARGO_GERENCIA_ID, process.env.CARGO_LIDER_ID];
                const temPermissao = interaction.member.roles.cache.some(role => cargosGerencia.includes(role.id));
                
                if (!temPermissao) {
                    return interaction.reply({
                        content: '❌ Apenas gerência pode cancelar pagamentos!',
                        flags: 64
                    });
                }
                
                const partes = interaction.customId.split('_');
                const semana = partes[2];
                const ano = partes[3];
                
                console.log(`❌ Pagamento cancelado por ${interaction.user.tag} - Semana ${semana}/${ano}`);
                
                await interaction.update({
                    content: `❌ **PAGAMENTO CANCELADO!**\n\n💰 Pagamento da semana ${semana} de ${ano} cancelado por ${interaction.user.username}.`,
                    embeds: [],
                    components: []
                });
                
                // Registrar cancelamento no banco
                try {
                    await supabase
                        .from('semanas_farm')
                        .update({ 
                            pago: false,
                            pago_por: null,
                            pago_em: null
                        })
                        .eq('semana_numero', semana)
                        .eq('ano', ano);
                    
                    console.log(`✅ Cancelamento de pagamento registrado no banco`);
                    
                } catch (error) {
                    console.error('❌ Erro ao registrar cancelamento:', error);
                }
            }
            
            // ✅ Botão de finalizar seleção de produtos (encomenda)
            else if (interaction.customId.startsWith('finalizar_selecao_')) {
                const tempId = interaction.customId.split('_')[2];
                await finalizarEncomenda(interaction, tempId);
            }
            
            // ✅ Botão de cancelar encomenda (durante criação)
            else if (interaction.customId.startsWith('cancelar_encomenda_temp_')) {
                const tempId = interaction.customId.split('_')[3];
                if (global.encomendasTemporarias && global.encomendasTemporarias[tempId]) {
                    delete global.encomendasTemporarias[tempId];
                }
                await interaction.update({
                    content: '❌ Encomenda cancelada.',
                    embeds: [],
                    components: []
                });
            }
            
            // ✅ Botão de finalizar encomenda (no canal da encomenda)
            else if (interaction.customId.startsWith('finalizar_encomenda_')) {
                const encomendaId = interaction.customId.split('_')[2];
                await finalizarEncomendaHandler(interaction, encomendaId);
            }
            
            // ✅ Botão de cancelar encomenda (no canal da encomenda)
            else if (interaction.customId.startsWith('cancelar_encomenda_') && !interaction.customId.includes('log')) {
                const encomendaId = interaction.customId.split('_')[2];
                await cancelarEncomendaHandler(interaction, encomendaId);
            }
            
            // ✅ Botão de cancelar encomenda (no canal de logs)
            else if (interaction.customId.startsWith('cancelar_encomenda_log_')) {
                const encomendaId = interaction.customId.split('_')[3];
                await cancelarEncomendaLogHandler(interaction, encomendaId);
            }
            
            // ✅ Botão para ver perfil do membro no log
            else if (interaction.customId.startsWith('ver_membro_')) {
                const discordId = interaction.customId.split('_')[2];
                
                // Buscar informações do membro
                const { data: membro, error } = await supabase
                    .from('membros')
                    .select('*')
                    .eq('discord_id', discordId)
                    .single();
                
                if (error || !membro) {
                    return interaction.reply({
                        content: '❌ Membro não encontrado no banco de dados!',
                        flags: 64
                    });
                }
                
                // Buscar logs do membro
                const { data: logs, error: errorLogs } = await supabase
                    .from('logs_registro')
                    .select('*')
                    .eq('discord_id', discordId)
                    .order('data_registro', { ascending: false })
                    .limit(5);
                
                const embed = new EmbedBuilder()
                    .setTitle(`👤 PERFIL DO MEMBRO`)
                    .setColor(0x3498DB)
                    .addFields(
                        { name: 'Nome', value: membro.nome, inline: true },
                        { name: 'Discord ID', value: membro.discord_id, inline: true },
                        { name: 'Telefone', value: membro.telefone || 'Não informado', inline: true },
                        { name: 'Recrutador', value: membro.recrutador || 'Não informado', inline: true },
                        { name: 'Hierarquia', value: membro.hierarquia || 'Membro', inline: true },
                        { name: 'Registrado em', value: new Date(membro.created_at).toLocaleString('pt-BR'), inline: true }
                    );
                
                if (logs && logs.length > 0) {
                    let historico = '';
                    logs.forEach((log, index) => {
                        const dataLog = new Date(log.data_registro).toLocaleString('pt-BR');
                        historico += `**${index + 1}. ${log.tipo_acao.toUpperCase()}**\n`;
                        historico += `Data: ${dataLog}\n`;
                        historico += `Por: <@${log.registrado_por}>\n\n`;
                    });
                    
                    embed.addFields({ name: '📜 HISTÓRICO', value: historico, inline: false });
                }
                
                await interaction.reply({
                    embeds: [embed],
                    flags: 64
                });
            }
            
            // ✅ Botão para promover membro
            else if (interaction.customId.startsWith('promover_')) {
                const discordId = interaction.customId.split('_')[1];
                
                // Verificar se é gerência
                const isGerencia = interaction.member.roles.cache.has(process.env.CARGO_GERENCIA_ID) || 
                                interaction.member.roles.cache.has(process.env.CARGO_LIDER_ID);
                
                if (!isGerencia) {
                    return interaction.reply({
                        content: '❌ Apenas gerência pode promover membros!',
                        flags: 64
                    });
                }
                
                // Criar modal para promoção
                const modal = new ModalBuilder()
                    .setCustomId(`promover_modal_${discordId}`)
                    .setTitle('Promover Membro');
                
                const novoCargoInput = new TextInputBuilder()
                    .setCustomId('novo_cargo_input')
                    .setLabel("Nova Hierarquia")
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder("Ex: Soldado, Sargento, Capitão...")
                    .setRequired(true)
                    .setMaxLength(50);
                
                const motivoInput = new TextInputBuilder()
                    .setCustomId('motivo_input')
                    .setLabel("Motivo da Promoção")
                    .setStyle(TextInputStyle.Paragraph)
                    .setPlaceholder("Descreva o motivo da promoção...")
                    .setRequired(true)
                    .setMaxLength(500);
                
                const primeiraLinha = new ActionRowBuilder().addComponents(novoCargoInput);
                const segundaLinha = new ActionRowBuilder().addComponents(motivoInput);
                
                modal.addComponents(primeiraLinha, segundaLinha);
                await interaction.showModal(modal);
            }
        }
        
        // Modais (formulários)
        else if (interaction.isModalSubmit()) {
            // Modal de registro de membro
            if (interaction.customId === 'registro_membro_modal') {
                const id = interaction.fields.getTextInputValue('id_input');
                const nome = interaction.fields.getTextInputValue('nome_input');
                const telefone = interaction.fields.getTextInputValue('telefone_input');
                const recrutador = interaction.fields.getTextInputValue('recrutador_input');
                
                try {
                    // Primeiro, responder para evitar timeout
                    await interaction.deferReply({ flags: 64 });
                    
                    // Verificar se já está registrado
                    const { data: membroExistente, error: errorCheck } = await supabase
                        .from('membros')
                        .select('*')
                        .eq('discord_id', interaction.user.id)
                        .single();

                    if (membroExistente) {
                        return interaction.editReply({
                            content: '❌ Você já está registrado!',
                            flags: 64
                        });
                    }
                    
                    // Inserir no banco de dados
                    const { data, error } = await supabase
                        .from('membros')
                        .insert([
                            {
                                discord_id: interaction.user.id,
                                nome: nome,
                                telefone: telefone,
                                recrutador: recrutador,
                                hierarquia: 'Membro',
                                cargo_id: process.env.CARGO_MEMBRO_ID
                            }
                        ])
                        .select()
                        .single();
                    
                    if (error) throw error;
                    
                    // REGISTRAR LOG
                    await registrarLogMembro(data, interaction.user.id, 'registro');
                    await enviarLogRegistroDiscord(interaction.client, data, interaction.user, id);
                    
                    // Tentar atualizar nickname
                    try {
                        const member = await interaction.guild.members.fetch(interaction.user.id);
                        const nickname = `${id} - ${nome}`;
                        
                        const botMember = await interaction.guild.members.fetch(interaction.client.user.id);
                        if (botMember.permissions.has('ManageNicknames')) {
                            await member.setNickname(nickname);
                            console.log(`✅ Nickname alterado para: ${nickname}`);
                        }
                        
                        // Adicionar cargo
                        const cargoMembro = interaction.guild.roles.cache.get(process.env.CARGO_MEMBRO_ID);
                        if (cargoMembro) {
                            await member.roles.add(cargoMembro);
                            console.log(`✅ Cargo ${cargoMembro.name} adicionado`);
                        }
                        
                    } catch (nicknameError) {
                        console.warn('⚠️  Não foi possível alterar o nickname:', nicknameError.message);
                    }
                    
                    await interaction.editReply({
                        content: `✅ **REGISTRO CONCLUÍDO!**\n\n📋 **ID:** ${id}\n👤 **Nome:** ${nome}\n📱 **Telefone:** ${telefone}\n🎯 **Recrutador:** ${recrutador}\n\nAgora você é um membro oficial da facção!`,
                        flags: 64
                    });
                    
                } catch (error) {
                    console.error('Erro no registro:', error);
                    await interaction.editReply({
                        content: '❌ Erro ao processar registro. Contate a administração.',
                        flags: 64
                    });
                }
            }
            
            // Modal de farm (SISTEMA SIMPLES)
            else if (interaction.customId.startsWith('farm_modal_')) {
                await processarModalFarmSimples(interaction);
            }
            
            // Modal de encomenda
            else if (interaction.customId === 'encomenda_modal') {
                await processarModalEncomenda(interaction);
            }
            
            // Modal de quantidade de produto
            else if (interaction.customId.startsWith('quantidade_modal_')) {
                await processarQuantidadeProduto(interaction);
            }
            
            // Modal de promoção de membro
            else if (interaction.customId.startsWith('promover_modal_')) {
                const discordId = interaction.customId.split('_')[2];
                const novoCargo = interaction.fields.getTextInputValue('novo_cargo_input');
                const motivo = interaction.fields.getTextInputValue('motivo_input');
                
                try {
                    await interaction.deferReply({ flags: 64 });
                    
                    // Atualizar hierarquia no banco
                    const { error } = await supabase
                        .from('membros')
                        .update({ hierarquia: novoCargo })
                        .eq('discord_id', discordId);
                    
                    if (error) throw error;
                    
                    // Registrar log da promoção
                    const { data: membro } = await supabase
                        .from('membros')
                        .select('*')
                        .eq('discord_id', discordId)
                        .single();
                    
                    if (membro) {
                        await registrarLogMembro({
                            ...membro,
                            hierarquia: novoCargo
                        }, interaction.user.id, 'atualizacao');
                    }
                    
                    // Enviar DM para o membro (se possível)
                    try {
                        const user = await interaction.client.users.fetch(discordId);
                        const dmEmbed = new EmbedBuilder()
                            .setTitle('🎉 PARABÉNS! Você foi promovido!')
                            .setColor(0x00FF00)
                            .addFields(
                                { name: 'Nova Hierarquia', value: novoCargo, inline: true },
                                { name: 'Promovido por', value: interaction.user.username, inline: true },
                                { name: 'Motivo', value: motivo, inline: false }
                            )
                            .setFooter({ text: 'Sistema de Hierarquia - Facção' })
                            .setTimestamp();
                        
                        await user.send({ embeds: [dmEmbed] });
                    } catch (dmError) {
                        console.log('⚠️  Não foi possível enviar DM para o membro:', dmError.message);
                    }
                    
                    // Atualizar mensagem original no log
                    const embedOriginal = EmbedBuilder.from(interaction.message.embeds[0]);
                    embedOriginal.setColor(0x00FF00);
                    embedOriginal.addFields({ name: '🎉 STATUS', value: `Promovido para: **${novoCargo}**\nPor: ${interaction.user.username}`, inline: false });
                    
                    await interaction.message.edit({
                        embeds: [embedOriginal],
                        components: []
                    });
                    
                    await interaction.editReply({
                        content: `✅ **Membro promovido com sucesso para: ${novoCargo}**`
                    });
                    
                } catch (error) {
                    console.error('❌ Erro ao promover membro:', error);
                    await interaction.editReply({
                        content: `❌ Erro ao promover membro: ${error.message}`,
                        flags: 64
                    });
                }
            }
        }
        
        // Menus de seleção (Select Menus)
        else if (interaction.isStringSelectMenu()) {
            // Seleção de tipo de farm
            if (interaction.customId === 'selecionar_tipo_farm') {
                await iniciarFarmSimples(interaction);
            }
            
            // Seleção de produto na encomenda
            else if (interaction.customId.startsWith('selecionar_produto_')) {
                const parts = interaction.customId.split('_');
                const tempId = parts[2];
                const produtoId = interaction.values[0];
                await mostrarModalQuantidade(interaction, produtoId, tempId);
            }
        }
        
        // Lida com outros tipos de interação
        else if (interaction.isMessageContextMenuCommand()) {
            // Para comandos de contexto (menu de mensagem)
            await interaction.reply({
                content: 'Este comando de contexto ainda não está implementado.',
                flags: 64
            });
        }
        
        else if (interaction.isUserContextMenuCommand()) {
            // Para comandos de contexto (menu de usuário)
            await interaction.reply({
                content: 'Este comando de contexto ainda não está implementado.',
                flags: 64
            });
        }
        
        else if (interaction.isAutocomplete()) {
            // Para autocompletar
            const command = client.commands.get(interaction.commandName);
            if (!command) return;
            
            try {
                await command.autocomplete(interaction);
            } catch (error) {
                console.error(error);
            }
        }
        
        // Tratamento para mensagens com botões
        else if (interaction.isMessageComponent()) {
            console.log(`🔧 Componente de mensagem: ${interaction.customId}`);
        }
    },
};