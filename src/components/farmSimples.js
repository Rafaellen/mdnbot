const { ActionRowBuilder, StringSelectMenuBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const supabase = require('../database/supabase');

// Sistema MUITO simples de farm
async function iniciarFarmSimples(interaction) {
    try {
        const tipoFarm = interaction.values[0];
        
        // Criar modal imediatamente para quantidade
        const modal = new ModalBuilder()
            .setCustomId(`farm_modal_${tipoFarm.replace(/\s+/g, '_')}_${Date.now()}`)
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
        
    } catch (error) {
        console.error('Erro ao iniciar farm simples:', error);
        if (interaction.replied || interaction.deferred) {
            await interaction.editReply({
                content: '❌ Erro ao iniciar registro de farm.',
                flags: 64
            });
        } else {
            await interaction.reply({
                content: '❌ Erro ao iniciar registro de farm.',
                flags: 64
            });
        }
    }
}

// Processar o modal de farm
async function processarModalFarmSimples(interaction) {
    try {
        await interaction.deferReply({ flags: 64 });
        
        const quantidade = interaction.fields.getTextInputValue('quantidade_input');
        const customIdParts = interaction.customId.split('_');
        const tipoFarm = customIdParts[2] ? customIdParts[2].replace(/_/g, ' ') : 'Dinheiro Sujo';
        
        // Converter para número
        const quantidadeLimpa = quantidade.replace(/\./g, '').replace(',', '.');
        const quantidadeNumero = parseInt(quantidadeLimpa);
        
        if (isNaN(quantidadeNumero)) {
            return await interaction.editReply({
                content: '❌ Quantidade inválida! Digite apenas números.',
                flags: 64
            });
        }
        
        if (quantidadeNumero > 1000000000) {
            return await interaction.editReply({
                content: '❌ Quantidade muito alta!',
                flags: 64
            });
        }
        
        // Buscar membro
        const { data: membro, error: membroError } = await supabase
            .from('membros')
            .select('id, nome')
            .eq('discord_id', interaction.user.id)
            .single();
        
        if (membroError || !membro) {
            return await interaction.editReply({
                content: '❌ Você precisa estar registrado para farmar!',
                flags: 64
            });
        }
        
        // Obter semana atual
        const data = new Date();
        const semanaNumero = getWeekNumber(data);
        const ano = data.getFullYear();
        
        // Determinar tipo de farm do customId
        let tipoFarmReal = tipoFarm;
        if (tipoFarm === 'Dinheiro') tipoFarmReal = 'Dinheiro Sujo';
        if (tipoFarm === 'Placa') tipoFarmReal = 'Placa de Circuito';
        
        // Inserir no banco SEM created_at (deixe o banco definir)
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
                    // REMOVA: created_at: new Date().toISOString()
                }
            ])
            .select()
            .single();
        
        if (insertError) {
            console.error('Erro ao inserir farm:', insertError);
            
            // Tentar sem data_farm também, caso esse seja o problema
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
            
            // Usar o segundo resultado se funcionou
            farmSalvo = farmSalvo2;
        }
        
        // Responder ao usuário
        await interaction.editReply({
            content: `✅ **FARM REGISTRADO COM SUCESSO!**\n\n👤 **Membro:** ${membro.nome}\n💰 **Quantidade:** ${quantidadeNumero.toLocaleString('pt-BR')}\n📦 **Tipo:** ${tipoFarmReal}\n🆔 **ID:** ${farmSalvo.id}`
        });
        
        // Enviar confirmação no canal
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
        
    } catch (error) {
        console.error('Erro ao processar modal farm:', error);
        await interaction.editReply({
            content: `❌ Erro ao registrar farm: ${error.message || 'Erro desconhecido'}`,
            flags: 64
        });
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