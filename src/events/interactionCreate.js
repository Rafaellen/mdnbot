const { Events, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
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

// Cache para prevenir processamento duplicado
const processedInteractions = new Map();

module.exports = {
    name: Events.InteractionCreate,
    async execute(interaction, client) {
        // Criar uma chave única para a interação
        const interactionKey = `${interaction.id}_${interaction.user.id}_${interaction.customId || interaction.commandName || 'unknown'}`;
        
        // Verificar se já processamos esta interação
        if (processedInteractions.has(interactionKey)) {
            console.log(`⚠️ Interação ${interactionKey} já processada, ignorando...`);
            return;
        }
        
        // Adicionar ao cache com timestamp
        processedInteractions.set(interactionKey, Date.now());
        
        // Limpar cache antigo (mais de 5 segundos)
        const now = Date.now();
        for (const [key, timestamp] of processedInteractions.entries()) {
            if (now - timestamp > 5000) {
                processedInteractions.delete(key);
            }
        }
        
        console.log(`🔧 Interação recebida: ${interaction.type} | ${interaction.customId || interaction.commandName || 'N/A'} | ID: ${interaction.id}`);
        
        try {
            // Comandos slash
            if (interaction.isChatInputCommand()) {
                const command = client.commands.get(interaction.commandName);
                if (!command) {
                    processedInteractions.delete(interactionKey);
                    return;
                }

                try {
                    await command.execute(interaction);
                } catch (error) {
                    console.error('❌ Erro ao executar comando:', error);
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({
                            content: '❌ Ocorreu um erro ao executar este comando!',
                            flags: MessageFlags.Ephemeral
                        });
                    }
                }
                processedInteractions.delete(interactionKey);
                return;
            }
            
            // Botões - CORREÇÃO CRÍTICA AQUI
            if (interaction.isButton()) {
                console.log(`🟢 Botão clicado: ${interaction.customId} | ID: ${interaction.id} | User: ${interaction.user.tag}`);
                
                try {
                    // Botão de iniciar encomenda - NÃO RESPONDER ANTES DO MODAL
                    if (interaction.customId === 'iniciar_encomenda') {
                        console.log('🛒 Processando botão iniciar_encomenda...');
                        
                        // Verificar permissões SEM responder primeiro
                        const isGerencia = interaction.member.roles.cache.has(process.env.CARGO_GERENCIA_ID) || 
                                          interaction.member.roles.cache.has(process.env.CARGO_LIDER_ID);
                        
                        if (!isGerencia) {
                            console.log('❌ Usuário não é gerência:', interaction.user.tag);
                            // Agora sim responder com erro
                            await interaction.reply({
                                content: '❌ Apenas gerência pode criar encomendas!',
                                flags: MessageFlags.Ephemeral
                            });
                            processedInteractions.delete(interactionKey);
                            return;
                        }
                        
                        console.log('✅ Usuário é gerência, mostrando modal...');
                        
                        // Mostrar modal SEM responder antes
                        try {
                            await iniciarEncomendaModal(interaction);
                        } catch (modalError) {
                            console.error('❌ Erro ao mostrar modal:', modalError);
                            
                            // Se o modal falhou, tentar enviar uma mensagem de erro
                            if (!interaction.replied && !interaction.deferred) {
                                await interaction.reply({
                                    content: '❌ Não foi possível abrir o formulário. Tente novamente.',
                                    flags: MessageFlags.Ephemeral
                                });
                            }
                        }
                        processedInteractions.delete(interactionKey);
                        return;
                    }
                    
                    // Botão de iniciar registro - também usa modal
                    if (interaction.customId === 'iniciar_registro') {
                        console.log('📝 Iniciando registro de membro...');
                        try {
                            await registrarMembroModal(interaction);
                        } catch (error) {
                            console.error('❌ Erro ao mostrar modal de registro:', error);
                        }
                        processedInteractions.delete(interactionKey);
                        return;
                    }
                    
                    // Botão de criar pasta farm
                    if (interaction.customId === 'criar_pasta_farm') {
                        console.log('📁 Criando pasta farm...');
                        try {
                            await criarPastaFarm(interaction);
                        } catch (error) {
                            console.error('❌ Erro ao criar pasta farm:', error);
                        }
                        processedInteractions.delete(interactionKey);
                        return;
                    }
                    
                    // ✅ Botão "Farm Pago" nas pastas individuais
                    if (interaction.customId.startsWith('farm_pago_')) {
                        const cargosGerencia = [process.env.CARGO_GERENCIA_ID, process.env.CARGO_LIDER_ID];
                        const temPermissao = interaction.member.roles.cache.some(role => cargosGerencia.includes(role.id));
                        
                        if (!temPermissao) {
                            await interaction.reply({
                                content: '❌ Apenas gerência pode marcar farm como pago!',
                                flags: MessageFlags.Ephemeral
                            });
                            processedInteractions.delete(interactionKey);
                            return;
                        }
                        
                        const partes = interaction.customId.split('_');
                        const semana = partes[2];
                        const ano = partes[3];
                        
                        console.log(`💰 Farm marcado como pago por ${interaction.user.tag} - Semana ${semana}/${ano}`);
                        
                        // Defer a resposta primeiro
                        await interaction.deferUpdate();
                        
                        try {
                            await supabase
                                .from('semanas_farm')
                                .update({ 
                                    pago: true,
                                    pago_por: interaction.user.id,
                                    pago_em: new Date().toISOString()
                                })
                                .eq('semana_numero', semana)
                                .eq('ano', ano);
                            
                            const resultadoReset = await resetarFarmsPagados(semana, ano, interaction.user.id);
                            
                            if (resultadoReset.success) {
                                await criarRegistroReset(semana, ano, interaction.user.id, resultadoReset.farmsResetados || 0);
                                
                                await interaction.editReply({
                                    content: `✅ **FARM PAGO E RESETADO COM SUCESSO!**\n\n💰 Pagamento da semana ${semana} de ${ano} confirmado por ${interaction.user.username}.\n🔄 ${resultadoReset.farmsResetados || 0} farms de dinheiro sujo foram resetados para 0.\n\n✅ Pronto para a próxima semana!`,
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
                            console.error('❌ Erro ao processar pagamento:', error);
                            await interaction.editReply({
                                content: `❌ **ERRO AO PROCESSAR PAGAMENTO**\n\nErro ao processar pagamento da semana ${semana} de ${ano}:\n\`\`\`${error.message || 'Erro desconhecido'}\`\`\``,
                                embeds: [],
                                components: []
                            });
                        }
                        processedInteractions.delete(interactionKey);
                        return;
                    }
                    
                    // ✅ Botão de finalizar seleção de produtos (encomenda)
                    if (interaction.customId.startsWith('finalizar_selecao_')) {
                        const tempId = interaction.customId.split('_')[2];
                        console.log(`✅ Finalizando seleção para encomenda temp: ${tempId}`);
                        try {
                            await finalizarEncomenda(interaction, tempId);
                        } catch (error) {
                            console.error('❌ Erro ao finalizar encomenda:', error);
                        }
                        processedInteractions.delete(interactionKey);
                        return;
                    }
                    
                    // ✅ Botão de cancelar encomenda (durante criação)
                    if (interaction.customId.startsWith('cancelar_encomenda_temp_')) {
                        const tempId = interaction.customId.split('_')[3];
                        if (global.encomendasTemporarias && global.encomendasTemporarias[tempId]) {
                            delete global.encomendasTemporarias[tempId];
                        }
                        await interaction.update({
                            content: '❌ Encomenda cancelada.',
                            embeds: [],
                            components: []
                        });
                        processedInteractions.delete(interactionKey);
                        return;
                    }
                    
                    // ✅ Botão de finalizar encomenda (no canal da encomenda)
                    if (interaction.customId.startsWith('finalizar_encomenda_')) {
                        const encomendaId = interaction.customId.split('_')[2];
                        try {
                            await finalizarEncomendaHandler(interaction, encomendaId);
                        } catch (error) {
                            console.error('❌ Erro ao finalizar encomenda:', error);
                        }
                        processedInteractions.delete(interactionKey);
                        return;
                    }
                    
                    // ✅ Botão de cancelar encomenda (no canal da encomenda)
                    if (interaction.customId.startsWith('cancelar_encomenda_') && !interaction.customId.includes('log')) {
                        const encomendaId = interaction.customId.split('_')[2];
                        try {
                            await cancelarEncomendaHandler(interaction, encomendaId);
                        } catch (error) {
                            console.error('❌ Erro ao cancelar encomenda:', error);
                        }
                        processedInteractions.delete(interactionKey);
                        return;
                    }
                    
                    // ✅ Botão de cancelar encomenda (no canal de logs)
                    if (interaction.customId.startsWith('cancelar_encomenda_log_')) {
                        const encomendaId = interaction.customId.split('_')[3];
                        try {
                            await cancelarEncomendaLogHandler(interaction, encomendaId);
                        } catch (error) {
                            console.error('❌ Erro ao cancelar encomenda do log:', error);
                        }
                        processedInteractions.delete(interactionKey);
                        return;
                    }
                    
                    // Se chegou aqui, botão não reconhecido
                    console.warn(`⚠️ Botão não reconhecido: ${interaction.customId}`);
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({
                            content: '⚠️ Este botão não está configurado corretamente.',
                            flags: MessageFlags.Ephemeral
                        });
                    }
                    processedInteractions.delete(interactionKey);
                    return;
                    
                } catch (error) {
                    console.error('❌ Erro ao processar botão:', error);
                    processedInteractions.delete(interactionKey);
                }
                return;
            }
            
            // Modais (formulários)
            if (interaction.isModalSubmit()) {
                console.log(`📋 Modal enviado: ${interaction.customId} | ID: ${interaction.id}`);
                
                try {
                    // Modal de encomenda
                    if (interaction.customId === 'encomenda_modal') {
                        console.log('📦 Processando modal de encomenda...');
                        try {
                            await processarModalEncomenda(interaction);
                        } catch (error) {
                            console.error('❌ Erro ao processar modal de encomenda:', error);
                        }
                        processedInteractions.delete(interactionKey);
                        return;
                    }
                    
                    // Modal de registro de membro
                    if (interaction.customId === 'registro_membro_modal') {
                        console.log('📝 Processando modal de registro...');
                        const id = interaction.fields.getTextInputValue('id_input');
                        const nome = interaction.fields.getTextInputValue('nome_input');
                        const telefone = interaction.fields.getTextInputValue('telefone_input');
                        const recrutador = interaction.fields.getTextInputValue('recrutador_input');
                        
                        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                        
                        // Verificar se já está registrado
                        const { data: membroExistente } = await supabase
                            .from('membros')
                            .select('*')
                            .eq('discord_id', interaction.user.id)
                            .single();

                        if (membroExistente) {
                            await interaction.editReply({
                                content: '❌ Você já está registrado!'
                            });
                            processedInteractions.delete(interactionKey);
                            return;
                        }
                        
                        // Inserir no banco de dados
                        const { data, error } = await supabase
                            .from('membros')
                            .insert([{
                                discord_id: interaction.user.id,
                                nome: nome,
                                telefone: telefone,
                                recrutador: recrutador,
                                hierarquia: 'Membro',
                                cargo_id: process.env.CARGO_MEMBRO_ID
                            }])
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
                            }
                            
                            // Adicionar cargo
                            const cargoMembro = interaction.guild.roles.cache.get(process.env.CARGO_MEMBRO_ID);
                            if (cargoMembro) {
                                await member.roles.add(cargoMembro);
                            }
                            
                        } catch (nicknameError) {
                            console.warn('⚠️  Não foi possível alterar o nickname:', nicknameError.message);
                        }
                        
                        await interaction.editReply({
                            content: `✅ **REGISTRO CONCLUÍDO!**\n\n📋 **ID:** ${id}\n👤 **Nome:** ${nome}\n📱 **Telefone:** ${telefone}\n🎯 **Recrutador:** ${recrutador}\n\nAgora você é um membro oficial da facção!`
                        });
                        processedInteractions.delete(interactionKey);
                        return;
                    }
                    
                    // Modal de farm (SISTEMA SIMPLES)
                    if (interaction.customId.startsWith('farm_modal_')) {
                        console.log('💰 Processando modal de farm...');
                        try {
                            await processarModalFarmSimples(interaction);
                        } catch (error) {
                            console.error('❌ Erro ao processar modal de farm:', error);
                        }
                        processedInteractions.delete(interactionKey);
                        return;
                    }
                    
                    // Modal de quantidade de produto
                    if (interaction.customId.startsWith('quantidade_modal_')) {
                        console.log('📊 Processando modal de quantidade...');
                        try {
                            await processarQuantidadeProduto(interaction);
                        } catch (error) {
                            console.error('❌ Erro ao processar modal de quantidade:', error);
                        }
                        processedInteractions.delete(interactionKey);
                        return;
                    }
                    
                    // Modal de promoção de membro
                    if (interaction.customId.startsWith('promover_modal_')) {
                        const discordId = interaction.customId.split('_')[2];
                        const novoCargo = interaction.fields.getTextInputValue('novo_cargo_input');
                        const motivo = interaction.fields.getTextInputValue('motivo_input');
                        
                        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                        
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
                        processedInteractions.delete(interactionKey);
                        return;
                    }
                    
                    // Se chegou aqui, modal não reconhecido
                    console.warn(`⚠️ Modal não reconhecido: ${interaction.customId}`);
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({
                            content: '⚠️ Este formulário não está configurado corretamente.',
                            flags: MessageFlags.Ephemeral
                        });
                    }
                    processedInteractions.delete(interactionKey);
                    return;
                    
                } catch (error) {
                    console.error('❌ Erro ao processar modal:', error);
                    processedInteractions.delete(interactionKey);
                }
                return;
            }
            
            // Menus de seleção (Select Menus)
            if (interaction.isStringSelectMenu()) {
                console.log(`📋 Menu selecionado: ${interaction.customId}`);
                
                try {
                    // Seleção de tipo de farm
                    if (interaction.customId === 'selecionar_tipo_farm') {
                        console.log('🏭 Processando seleção de tipo de farm...');
                        try {
                            await iniciarFarmSimples(interaction);
                        } catch (error) {
                            console.error('❌ Erro ao processar seleção de farm:', error);
                        }
                        processedInteractions.delete(interactionKey);
                        return;
                    }
                    
                    // Seleção de produto na encomenda
                    if (interaction.customId.startsWith('selecionar_produto_')) {
                        const parts = interaction.customId.split('_');
                        const tempId = parts[2];
                        const produtoId = interaction.values[0];
                        console.log(`🛒 Produto selecionado: ${produtoId} para encomenda temp: ${tempId}`);
                        try {
                            await mostrarModalQuantidade(interaction, produtoId, tempId);
                        } catch (error) {
                            console.error('❌ Erro ao processar seleção de produto:', error);
                        }
                        processedInteractions.delete(interactionKey);
                        return;
                    }
                    
                    // Se chegou aqui, menu não reconhecido
                    console.warn(`⚠️ Menu não reconhecido: ${interaction.customId}`);
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({
                            content: '⚠️ Este menu não está configurado corretamente.',
                            flags: MessageFlags.Ephemeral
                        });
                    }
                    processedInteractions.delete(interactionKey);
                    return;
                    
                } catch (error) {
                    console.error('❌ Erro ao processar menu de seleção:', error);
                    processedInteractions.delete(interactionKey);
                }
                return;
            }
            
            // Lida com outros tipos de interação
            if (interaction.isMessageContextMenuCommand()) {
                try {
                    await interaction.reply({
                        content: 'Este comando de contexto ainda não está implementado.',
                        flags: MessageFlags.Ephemeral
                    });
                } catch (error) {
                    console.error('❌ Erro ao processar comando de contexto:', error);
                }
                processedInteractions.delete(interactionKey);
                return;
            }
            
            if (interaction.isUserContextMenuCommand()) {
                try {
                    await interaction.reply({
                        content: 'Este comando de contexto ainda não está implementado.',
                        flags: MessageFlags.Ephemeral
                    });
                } catch (error) {
                    console.error('❌ Erro ao processar comando de contexto:', error);
                }
                processedInteractions.delete(interactionKey);
                return;
            }
            
            if (interaction.isAutocomplete()) {
                const command = client.commands.get(interaction.commandName);
                if (!command) {
                    processedInteractions.delete(interactionKey);
                    return;
                }
                
                try {
                    await command.autocomplete(interaction);
                } catch (error) {
                    console.error('❌ Erro ao processar autocomplete:', error);
                }
                processedInteractions.delete(interactionKey);
                return;
            }
            
            // Se chegou aqui, tipo de interação não reconhecido
            console.warn(`⚠️ Tipo de interação não reconhecido: ${interaction.type}`);
            processedInteractions.delete(interactionKey);
            
        } catch (error) {
            console.error('❌ Erro geral no interactionCreate:', error);
            processedInteractions.delete(interactionKey);
        }
    },
};