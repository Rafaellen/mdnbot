const { 
    ActionRowBuilder, 
    ModalBuilder, 
    TextInputBuilder, 
    TextInputStyle,
    EmbedBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');
const supabase = require('../database/supabase');

/**
 * Mostrar modal para registrar comprovante de pagamento
 */
async function mostrarModalComprovanteDropdown(interaction) {
    try {
        console.log('💰 Mostrando modal para comprovante de pagamento via dropdown...');
        
        const modal = new ModalBuilder()
            .setCustomId('modal_comprovante_dropdown')
            .setTitle('💰 Registrar Comprovante de Pagamento');

        const valorInput = new TextInputBuilder()
            .setCustomId('valor_input')
            .setLabel("Valor Pago (Dinheiro Limpo)")
            .setStyle(TextInputStyle.Short)
            .setPlaceholder("Ex: 108000")
            .setRequired(true)
            .setMaxLength(20);

        const semanaInput = new TextInputBuilder()
            .setCustomId('semana_input')
            .setLabel("Semana do Pagamento")
            .setStyle(TextInputStyle.Short)
            .setPlaceholder("Ex: 3 (deixe em branco para semana atual)")
            .setRequired(false)
            .setMaxLength(10);

        const observacaoInput = new TextInputBuilder()
            .setCustomId('observacao_input')
            .setLabel("Observação (opcional)")
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder("Alguma observação sobre o pagamento...")
            .setRequired(false)
            .setMaxLength(500);

        const primeiraLinha = new ActionRowBuilder().addComponents(valorInput);
        const segundaLinha = new ActionRowBuilder().addComponents(semanaInput);
        const terceiraLinha = new ActionRowBuilder().addComponents(observacaoInput);

        modal.addComponents(primeiraLinha, segundaLinha, terceiraLinha);
        
        await interaction.showModal(modal);
        console.log('✅ Modal de comprovante via dropdown mostrado!');
        
    } catch (error) {
        console.error('❌ Erro ao mostrar modal de comprovante:', error);
        
        if (error.code === 40060) {
            // Interação já reconhecida, tudo bem
            return;
        }
        
        try {
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                    content: '❌ Erro ao abrir formulário de comprovante.',
                    flags: 64
                });
            }
        } catch (replyError) {
            console.error('Não foi possível responder:', replyError);
        }
    }
}

/**
 * Processar modal de comprovante via dropdown
 */
async function processarModalComprovanteDropdown(interaction) {
    try {
        await interaction.deferReply({ flags: 64 });
        
        const valor = interaction.fields.getTextInputValue('valor_input');
        const semana = interaction.fields.getTextInputValue('semana_input') || '';
        const observacao = interaction.fields.getTextInputValue('observacao_input') || '';
        
        console.log(`💰 Comprovante via dropdown: Valor: ${valor}, Semana: ${semana || 'atual'}, Obs: ${observacao || 'Nenhuma'}`);
        
        // Verificar se é gerência (verificação adicional)
        const isGerencia = interaction.member.roles.cache.has(process.env.CARGO_GERENCIA_ID) || 
                           interaction.member.roles.cache.has(process.env.CARGO_LIDER_ID);
        
        if (!isGerencia) {
            return interaction.editReply({
                content: '❌ **Apenas gerência pode registrar comprovantes!**'
            });
        }
        
        // Verificar valor
        const valorNum = parseInt(valor.replace(/\./g, '').replace(',', '.'));
        if (isNaN(valorNum) || valorNum <= 0) {
            return interaction.editReply({
                content: '❌ Valor inválido! Digite um número maior que 0.'
            });
        }
        
        // Determinar semana
        let semanaNumero;
        let ano;
        
        if (semana) {
            semanaNumero = parseInt(semana);
            if (isNaN(semanaNumero) || semanaNumero < 1 || semanaNumero > 53) {
                return interaction.editReply({
                    content: '❌ Número da semana inválido! Deve ser entre 1 e 53.'
                });
            }
            ano = new Date().getFullYear();
        } else {
            // Usar semana atual
            const data = new Date();
            semanaNumero = getWeekNumber(data);
            ano = data.getFullYear();
        }
        
        // Buscar informações da pasta/membro
        const { data: pasta, error: pastaError } = await supabase
            .from('pastas_farm')
            .select(`
                canal_id,
                membros (
                    id,
                    nome,
                    discord_id
                )
            `)
            .eq('canal_id', interaction.channel.id)
            .single();
        
        if (pastaError || !pasta) {
            return interaction.editReply({
                content: '❌ Pasta farm não encontrada!'
            });
        }
        
        const membroNome = pasta.membros?.nome || 'Desconhecido';
        const membroId = pasta.membros?.id;
        
        // Salvar comprovante no banco
        const { error: saveError } = await supabase
            .from('comprovantes_pagamento')
            .insert([
                {
                    semana_numero: semanaNumero,
                    ano: ano,
                    membro_id: membroId,
                    membro_nome: membroNome,
                    valor_pago: valorNum,
                    observacao: observacao,
                    enviado_por: interaction.user.id,
                    enviado_por_nome: interaction.user.username,
                    canal_id: interaction.channel.id,
                    data_envio: new Date().toISOString()
                }
            ]);
        
        if (saveError) {
            console.error('❌ Erro ao salvar comprovante:', saveError);
            return interaction.editReply({
                content: '❌ Erro ao salvar comprovante no banco de dados.'
            });
        }
        
        // Criar embed de confirmação
        const embed = new EmbedBuilder()
            .setTitle('✅ COMPROVANTE REGISTRADO')
            .setColor(0x00FF00)
            .addFields(
                { name: '👤 Membro', value: membroNome, inline: true },
                { name: '💰 Valor Pago', value: `$${valorNum.toLocaleString('pt-BR')}`, inline: true },
                { name: '📅 Semana', value: `${semanaNumero}/${ano}`, inline: true },
                { name: '🛠️ Registrado por', value: interaction.user.username, inline: true },
                { name: '📅 Data', value: new Date().toLocaleDateString('pt-BR'), inline: true }
            )
            .setFooter({ text: 'Comprovante registrado com sucesso!' })
            .setTimestamp();
        
        if (observacao) {
            embed.addFields({
                name: '📝 Observação',
                value: observacao,
                inline: false
            });
        }
        
        // Criar botão para fechar farm
        const botoes = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`fechar_farm_${semanaNumero}_${ano}_${interaction.channel.id}`)
                    .setLabel('🔒 FECHAR FARM')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('🔒'),
                new ButtonBuilder()
                    .setCustomId(`ver_comprovantes_${membroId}`)
                    .setLabel('📋 VER COMPROVANTES')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('📋')
            );
        
        await interaction.editReply({
            content: `✅ **COMPROVANTE DE PAGAMENTO REGISTRADO COM SUCESSO!**\n\n💰 **${membroNome}** recebeu **$${valorNum.toLocaleString('pt-BR')}** na semana **${semanaNumero}**.`,
            embeds: [embed],
            components: [botoes]
        });
        
        console.log(`✅ Comprovante registrado para ${membroNome} - $${valorNum} (Semana ${semanaNumero})`);
        
    } catch (error) {
        console.error('❌ Erro ao processar comprovante via dropdown:', error);
        
        try {
            if (interaction.deferred) {
                await interaction.editReply({
                    content: `❌ Erro: ${error.message || 'Erro ao processar comprovante'}`
                });
            }
        } catch (editError) {
            console.error('Não foi possível editar resposta:', editError);
        }
    }
}

/**
 * Função para fechar farm (marcar como pago)
 */
async function fecharFarm(interaction, semanaNumero, ano, canalId) {
    try {
        await interaction.deferReply({ flags: 64 });
        
        // Verificar se é gerência
        const isGerencia = interaction.member.roles.cache.has(process.env.CARGO_GERENCIA_ID) || 
                           interaction.member.roles.cache.has(process.env.CARGO_LIDER_ID);
        
        if (!isGerencia) {
            return interaction.editReply({
                content: '❌ Apenas gerência pode fechar farms!'
            });
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
            return interaction.editReply({
                content: '❌ Pasta farm não encontrada!'
            });
        }
        
        // Atualizar pasta como fechada
        const { error: updateError } = await supabase
            .from('pastas_farm')
            .update({ 
                ativa: false,
                semana_fechada: semanaNumero,
                ano_fechada: ano,
                fechado_por: interaction.user.id,
                fechado_em: new Date().toISOString()
            })
            .eq('canal_id', canalId);
        
        if (updateError) {
            console.error('❌ Erro ao fechar pasta:', updateError);
            return interaction.editReply({
                content: '❌ Erro ao fechar pasta farm.'
            });
        }
        
        // Buscar comprovante para esta semana
        const { data: comprovante, error: comprovanteError } = await supabase
            .from('comprovantes_pagamento')
            .select('*')
            .eq('canal_id', canalId)
            .eq('semana_numero', semanaNumero)
            .eq('ano', ano)
            .order('data_envio', { ascending: false })
            .limit(1)
            .single();
        
        const embed = new EmbedBuilder()
            .setTitle('🔒 FARM FECHADO')
            .setColor(0xFFA500)
            .setDescription(`**Farm da semana ${semanaNumero} de ${ano} foi fechado!**`)
            .addFields(
                { name: '👤 Membro', value: pasta.membros?.nome || 'Desconhecido', inline: true },
                { name: '📅 Semana', value: `${semanaNumero}/${ano}`, inline: true },
                { name: '🛠️ Fechado por', value: interaction.user.username, inline: true }
            )
            .setFooter({ text: 'Farm marcado como fechado e pago' })
            .setTimestamp();
        
        if (comprovante && !comprovanteError) {
            embed.addFields(
                { name: '💰 Valor Pago', value: `$${comprovante.valor_pago?.toLocaleString('pt-BR') || '0'}`, inline: true },
                { name: '📅 Data do Pagamento', value: new Date(comprovante.data_envio).toLocaleDateString('pt-BR'), inline: true }
            );
            
            if (comprovante.observacao) {
                embed.addFields({
                    name: '📝 Observação do Pagamento',
                    value: comprovante.observacao,
                    inline: false
                });
            }
        }
        
        await interaction.editReply({
            content: `🔒 **FARM FECHADO COM SUCESSO!**\n\nA pasta de ${pasta.membros?.nome || 'membro'} foi marcada como fechada para a semana ${semanaNumero}.`,
            embeds: [embed],
            components: [] // Remover botões
        });
        
        console.log(`✅ Farm fechado para canal ${canalId}, semana ${semanaNumero}`);
        
    } catch (error) {
        console.error('❌ Erro ao fechar farm:', error);
        await interaction.editReply({
            content: `❌ Erro: ${error.message}`
        });
    }
}

/**
 * Ver comprovantes de um membro
 */
async function verComprovantesMembro(interaction, membroId) {
    try {
        await interaction.deferReply({ flags: 64 });
        
        const { data: comprovantes, error } = await supabase
            .from('comprovantes_pagamento')
            .select('*')
            .eq('membro_id', membroId)
            .order('data_envio', { ascending: false })
            .limit(10);
        
        if (error) {
            throw error;
        }
        
        if (!comprovantes || comprovantes.length === 0) {
            return interaction.editReply({
                content: '📭 Nenhum comprovante encontrado para este membro.'
            });
        }
        
        const totalPago = comprovantes.reduce((sum, c) => sum + (c.valor_pago || 0), 0);
        
        const embed = new EmbedBuilder()
            .setTitle(`📋 COMPROVANTES - ${comprovantes[0]?.membro_nome || 'Membro'}`)
            .setColor(0x3498DB)
            .setDescription(`**Total de comprovantes:** ${comprovantes.length}\n**Total pago:** $${totalPago.toLocaleString('pt-BR')}`)
            .setFooter({ text: 'Últimos 10 comprovantes' })
            .setTimestamp();
        
        comprovantes.forEach((comp, index) => {
            embed.addFields({
                name: `${index + 1}. Semana ${comp.semana_numero}/${comp.ano}`,
                value: `💰 **Valor:** $${comp.valor_pago?.toLocaleString('pt-BR') || '0'}\n🛠️ **Por:** ${comp.enviado_por_nome}\n📅 **Data:** ${new Date(comp.data_envio).toLocaleDateString('pt-BR')}\n${comp.observacao ? `📝 **Obs:** ${comp.observacao.substring(0, 50)}...` : ''}`,
                inline: true
            });
        });
        
        await interaction.editReply({
            embeds: [embed]
        });
        
    } catch (error) {
        console.error('❌ Erro ao listar comprovantes:', error);
        await interaction.editReply({
            content: `❌ Erro: ${error.message}`
        });
    }
}

// Função auxiliar para obter número da semana
function getWeekNumber(d) {
    d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return weekNo;
}

module.exports = {
    mostrarModalComprovanteDropdown,
    processarModalComprovanteDropdown,
    fecharFarm,
    verComprovantesMembro
};