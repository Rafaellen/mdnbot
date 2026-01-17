const { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const supabase = require('../database/supabase');

// Sistema MUITO simples de farm
async function iniciarFarmSimples(interaction) {
    try {
        console.log(`🔘 Iniciando farm simples para: ${interaction.user.tag}`);
        
        // VERIFICAR se a interação já foi respondida
        if (interaction.replied || interaction.deferred) {
            console.log('⚠️ Interação já respondida, criando nova mensagem...');
            
            // Enviar uma nova mensagem em vez de usar a interação
            await interaction.channel.send({
                content: '⚠️ **Por favor, clique novamente no menu!**\n\nO sistema detectou um erro. Selecione novamente o tipo de farm.',
                flags: 64
            });
            return;
        }
        
        const tipoFarm = interaction.values[0];
        console.log(`📦 Tipo selecionado: ${tipoFarm}`);
        
        // Criar modal imediatamente para quantidade
        const modalId = `farm_modal_${tipoFarm.replace(/\s+/g, '_')}_${Date.now()}`;
        console.log(`🔧 Modal ID: ${modalId}`);
        
        const modal = new ModalBuilder()
            .setCustomId(modalId)
            .setTitle(`Farm: ${tipoFarm}`);

        const quantidadeInput = new TextInputBuilder()
            .setCustomId('quantidade_input')
            .setLabel(`Quantidade de ${tipoFarm}`)
            .setStyle(TextInputStyle.Short)
            .setPlaceholder("Digite a quantidade (ex: 1000)")
            .setRequired(true)
            .setMaxLength(20);

        const linha = new ActionRowBuilder().addComponents(quantidadeInput);
        modal.addComponents(linha);

        await interaction.showModal(modal);
        console.log('✅ Modal mostrado com sucesso');
        
    } catch (error) {
        console.error('❌ Erro ao iniciar farm simples:', error);
        
        // Tentar resposta alternativa
        try {
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                    content: '❌ Erro ao iniciar registro de farm. Tente novamente.',
                    flags: 64,
                    ephemeral: true
                });
            } else {
                // Se já foi respondido, enviar mensagem normal
                await interaction.channel.send({
                    content: '❌ Erro ao iniciar registro de farm. Tente novamente.',
                    flags: 64
                });
            }
        } catch (replyError) {
            console.error('Não foi possível responder:', replyError.message);
        }
    }
}

// Processar o modal de farm
async function processarModalFarmSimples(interaction) {
    console.log(`📦 Processando modal farm: ${interaction.customId}`);
    
    try {
        // TENTAR deferReply com tratamento de erro
        let podeResponder = false;
        try {
            await interaction.deferReply({ flags: 64 });
            console.log('✅ deferReply bem-sucedido');
            podeResponder = true;
        } catch (deferError) {
            console.log('⚠️ deferReply falhou:', deferError.message);
            
            // Verificar se já foi respondido
            if (interaction.replied || interaction.deferred) {
                console.log('⚠️ Interação já respondida, ignorando...');
                return;
            }
            
            // Tentar responder normalmente
            try {
                await interaction.reply({
                    content: '⏳ Processando...',
                    flags: 64,
                    ephemeral: true
                });
                podeResponder = true;
                console.log('✅ Reply normal bem-sucedido');
            } catch (replyError) {
                console.error('❌ Não foi possível responder:', replyError.message);
                return;
            }
        }
        
        if (!podeResponder) {
            console.log('❌ Não é possível responder a esta interação');
            return;
        }
        
        const quantidade = interaction.fields.getTextInputValue('quantidade_input');
        const customIdParts = interaction.customId.split('_');
        const tipoFarm = customIdParts[2] ? customIdParts[2].replace(/_/g, ' ') : 'Dinheiro Sujo';
        
        console.log(`📊 Dados recebidos: Tipo: ${tipoFarm}, Quantidade: ${quantidade}`);
        
        // Converter para número
        const quantidadeLimpa = quantidade.replace(/\./g, '').replace(',', '.');
        const quantidadeNumero = parseInt(quantidadeLimpa);
        
        if (isNaN(quantidadeNumero)) {
            console.log('❌ Quantidade inválida:', quantidade);
            return await interaction.editReply({
                content: '❌ Quantidade inválida! Digite apenas números.',
                flags: 64
            });
        }
        
        if (quantidadeNumero > 1000000000) {
            console.log('❌ Quantidade muito alta:', quantidadeNumero);
            return await interaction.editReply({
                content: '❌ Quantidade muito alta!',
                flags: 64
            });
        }
        
        // Buscar membro
        console.log('👤 Buscando membro no banco...');
        const { data: membro, error: membroError } = await supabase
            .from('membros')
            .select('id, nome')
            .eq('discord_id', interaction.user.id)
            .single();
        
        if (membroError || !membro) {
            console.log('❌ Membro não encontrado:', membroError?.message);
            return await interaction.editReply({
                content: '❌ Você precisa estar registrado para farmar!',
                flags: 64
            });
        }
        
        console.log(`✅ Membro encontrado: ${membro.nome} (ID: ${membro.id})`);
        
        // Obter semana atual
        const data = new Date();
        const semanaNumero = getWeekNumber(data);
        const ano = data.getFullYear();
        
        // Determinar tipo de farm do customId
        let tipoFarmReal = tipoFarm;
        if (tipoFarm === 'Dinheiro') tipoFarmReal = 'Dinheiro Sujo';
        if (tipoFarm === 'Placa') tipoFarmReal = 'Placa de Circuito';
        
        console.log(`📅 Inserindo farm: Semana ${semanaNumero}, Ano ${ano}, Tipo: ${tipoFarmReal}`);
        
        // Inserir no banco
        const { data: farmSalvo, error: insertError } = await supabase
            .from('farm_semanal')
            .insert([
                {
                    membro_id: membro.id,
                    tipo_farm: tipoFarmReal,
                    quantidade: quantidadeNumero,
                    semana_id: semanaNumero,
                    ano: ano,
                    data_farm: new Date().toISOString()
                }
            ])
            .select()
            .single();
        
        if (insertError) {
            console.error('❌ Erro ao inserir farm:', insertError);
            
            // Tentar sem data_farm
            const { data: farmSalvo2, error: insertError2 } = await supabase
                .from('farm_semanal')
                .insert([
                    {
                        membro_id: membro.id,
                        tipo_farm: tipoFarmReal,
                        quantidade: quantidadeNumero,
                        semana_id: semanaNumero,
                        ano: ano
                    }
                ])
                .select()
                .single();
                
            if (insertError2) {
                throw insertError2;
            }
            
            farmSalvo = farmSalvo2;
        }
        
        console.log(`✅ Farm registrado com ID: ${farmSalvo.id}`);
        
        // Responder ao usuário
        await interaction.editReply({
            content: `✅ **FARM REGISTRADO COM SUCESSO!**\n\n👤 **Membro:** ${membro.nome}\n💰 **Quantidade:** ${quantidadeNumero.toLocaleString('pt-BR')}\n📦 **Tipo:** ${tipoFarmReal}\n🆔 **ID:** ${farmSalvo.id}`,
            flags: 64
        });
        
        // Enviar confirmação no canal
        try {
            const { EmbedBuilder } = require('discord.js');
            const confirmacaoEmbed = new EmbedBuilder()
                .setTitle('✅ FARM REGISTRADO')
                .setColor(0x00FF00)
                .addFields(
                    { name: '👤 Membro', value: membro.nome, inline: true },
                    { name: '📦 Tipo', value: tipoFarmReal, inline: true },
                    { name: '💰 Quantidade', value: quantidadeNumero.toLocaleString('pt-BR'), inline: true },
                    { name: '📅 Data', value: new Date().toLocaleDateString('pt-BR'), inline: true },
                    { name: '🆔 ID', value: farmSalvo.id.toString(), inline: true }
                )
                .setFooter({ text: `Registrado por: ${interaction.user.username}` })
                .setTimestamp();
            
            await interaction.channel.send({ embeds: [confirmacaoEmbed] });
            console.log('✅ Confirmação enviada no canal');
            
        } catch (embedError) {
            console.log('⚠️ Não foi possível enviar embed:', embedError.message);
        }
        
    } catch (error) {
        console.error('❌ Erro ao processar modal farm:', error);
        
        try {
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({
                    content: `❌ Erro ao registrar farm: ${error.message || 'Erro desconhecido'}`,
                    flags: 64
                });
            }
        } catch (editError) {
            console.error('❌ Não foi possível editar resposta:', editError.message);
        }
    }
}

// Função para obter número da semana
function getWeekNumber(d) {
    d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return weekNo;
}

module.exports = {
    iniciarFarmSimples,
    processarModalFarmSimples
};