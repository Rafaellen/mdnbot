const { 
    ActionRowBuilder, 
    ModalBuilder, 
    TextInputBuilder, 
    TextInputStyle,
    EmbedBuilder,
    AttachmentBuilder
} = require('discord.js');
const supabase = require('../database/supabase');

/**
 * Mostrar modal para upload de comprovante
 */
async function mostrarModalComprovante(interaction) {
    try {
        const customIdParts = interaction.customId.split('_');
        const semanaNumero = customIdParts[2];
        const ano = customIdParts[3];
        const canalId = customIdParts[4];
        
        console.log(`📎 Modal comprovante: Semana ${semanaNumero}, Ano ${ano}, Canal ${canalId}`);
        
        const modal = new ModalBuilder()
            .setCustomId(`modal_comprovante_${semanaNumero}_${ano}_${canalId}`)
            .setTitle('📎 Enviar Comprovante de Pagamento');

        const valorInput = new TextInputBuilder()
            .setCustomId('valor_input')
            .setLabel("Valor Pago")
            .setStyle(TextInputStyle.Short)
            .setPlaceholder("Ex: 108000")
            .setRequired(true)
            .setMaxLength(20);

        const observacaoInput = new TextInputBuilder()
            .setCustomId('observacao_input')
            .setLabel("Observação (opcional)")
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder("Alguma observação sobre o pagamento...")
            .setRequired(false)
            .setMaxLength(500);

        const primeiraLinha = new ActionRowBuilder().addComponents(valorInput);
        const segundaLinha = new ActionRowBuilder().addComponents(observacaoInput);

        modal.addComponents(primeiraLinha, segundaLinha);
        
        await interaction.showModal(modal);
        console.log('✅ Modal de comprovante mostrado!');
        
    } catch (error) {
        console.error('❌ Erro ao mostrar modal de comprovante:', error);
        
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
                content: '❌ Erro ao abrir formulário de comprovante.',
                flags: 64
            });
        }
    }
}

/**
 * Processar modal de comprovante e permitir upload de imagem
 */
async function processarModalComprovante(interaction) {
    try {
        await interaction.deferReply({ flags: 64 });
        
        const customIdParts = interaction.customId.split('_');
        const semanaNumero = customIdParts[2];
        const ano = customIdParts[3];
        const canalId = customIdParts[4];
        
        const valor = interaction.fields.getTextInputValue('valor_input');
        const observacao = interaction.fields.getTextInputValue('observacao_input') || '';
        
        console.log(`💰 Comprovante: Semana ${semanaNumero}, Valor: ${valor}, Obs: ${observacao}`);
        
        // Verificar se é gerência
        const isGerencia = interaction.member.roles.cache.has(process.env.CARGO_GERENCIA_ID) || 
                           interaction.member.roles.cache.has(process.env.CARGO_LIDER_ID);
        
        if (!isGerencia) {
            return interaction.editReply({
                content: '❌ Apenas gerência pode enviar comprovantes!'
            });
        }
        
        // Verificar valor
        const valorNum = parseInt(valor.replace(/\./g, '').replace(',', '.'));
        if (isNaN(valorNum) || valorNum <= 0) {
            return interaction.editReply({
                content: '❌ Valor inválido! Digite um número maior que 0.'
            });
        }
        
        // Buscar informações da pasta
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
            .eq('canal_id', canalId)
            .single();
        
        if (pastaError || !pasta) {
            return interaction.editReply({
                content: '❌ Pasta farm não encontrada!'
            });
        }
        
        const membroNome = pasta.membros?.nome || 'Desconhecido';
        const membroDiscordId = pasta.membros?.discord_id;
        
        // Salvar informações do comprovante no banco
        const { error: saveError } = await supabase
            .from('comprovantes_pagamento')
            .insert([
                {
                    semana_numero: semanaNumero,
                    ano: ano,
                    membro_id: pasta.membros?.id,
                    membro_nome: membroNome,
                    valor_pago: valorNum,
                    observacao: observacao,
                    enviado_por: interaction.user.id,
                    enviado_por_nome: interaction.user.username,
                    canal_id: canalId,
                    data_envio: new Date().toISOString()
                }
            ]);
        
        if (saveError) {
            console.error('❌ Erro ao salvar comprovante:', saveError);
            return interaction.editReply({
                content: '❌ Erro ao salvar informações do comprovante.'
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
                { name: '🛠️ Enviado por', value: interaction.user.username, inline: true },
                { name: '📅 Data', value: new Date().toLocaleDateString('pt-BR'), inline: true }
            )
            .setFooter({ text: 'Anexe a imagem do comprovante na próxima mensagem' })
            .setTimestamp();
        
        if (observacao) {
            embed.addFields({
                name: '📝 Observação',
                value: observacao,
                inline: false
            });
        }
        
        await interaction.editReply({
            content: `📎 **AGORA ANEXE A IMAGEM DO COMPROVANTE!**\n\nPor favor, envie a imagem do comprovante nesta conversa. O bot NÃO irá processar como um registro de farm.`,
            embeds: [embed]
        });
        
        console.log(`✅ Comprovante registrado para ${membroNome} - $${valorNum}`);
        
    } catch (error) {
        console.error('❌ Erro ao processar modal de comprovante:', error);
        
        if (interaction.deferred) {
            await interaction.editReply({
                content: `❌ Erro: ${error.message || 'Erro ao processar comprovante'}`
            });
        }
    }
}

/**
 * Verificar se mensagem é um comprovante (imagem após modal de comprovante)
 */
async function verificarComprovante(message) {
    try {
        // Verificar se é mensagem com imagem
        if (message.attachments.size === 0 || !message.attachments.first().contentType?.startsWith('image/')) {
            return false;
        }
        
        // Verificar se o autor é gerência
        const member = await message.guild.members.fetch(message.author.id);
        const isGerencia = member.roles.cache.has(process.env.CARGO_GERENCIA_ID) || 
                          member.roles.cache.has(process.env.CARGO_LIDER_ID);
        
        if (!isGerencia) {
            return false;
        }
        
        // Verificar se há mensagem anterior do bot sobre comprovante
        const messages = await message.channel.messages.fetch({ limit: 5 });
        const botMessage = messages.find(msg => 
            msg.author.id === message.client.user.id && 
            msg.content.includes('AGORA ANEXE A IMAGEM DO COMPROVANTE')
        );
        
        if (!botMessage) {
            return false;
        }
        
        // Esta é uma imagem de comprovante, não processar como farm
        console.log(`📎 Imagem de comprovante detectada em ${message.channel.name}`);
        
        // Adicionar reação de confirmação
        await message.react('✅');
        
        // Atualizar embed anterior
        const embed = EmbedBuilder.from(botMessage.embeds[0])
            .setDescription('✅ **COMPROVANTE ENVIADO COM SUCESSO!**\n\nO pagamento foi registrado e o comprovante foi anexado.')
            .addFields({
                name: '🖼️ Comprovante',
                value: `[Clique para ver](${message.attachments.first().url})`,
                inline: true
            });
        
        await botMessage.edit({
            content: `✅ **COMPROVANTE DE PAGAMENTO REGISTRADO!**\n\n👤 Membro: ${embed.data.fields?.find(f => f.name === '👤 Membro')?.value || 'N/A'}\n💰 Valor: ${embed.data.fields?.find(f => f.name === '💰 Valor Pago')?.value || 'N/A'}`,
            embeds: [embed]
        });
        
        // Não responder com dropdown de farm
        return true;
        
    } catch (error) {
        console.error('❌ Erro ao verificar comprovante:', error);
        return false;
    }
}

/**
 * Listar comprovantes de uma semana
 */
async function listarComprovantes(interaction, semanaNumero, ano) {
    try {
        await interaction.deferReply({ flags: 64 });
        
        const { data: comprovantes, error } = await supabase
            .from('comprovantes_pagamento')
            .select('*')
            .eq('semana_numero', semanaNumero)
            .eq('ano', ano)
            .order('data_envio', { ascending: false });
        
        if (error) {
            throw error;
        }
        
        if (!comprovantes || comprovantes.length === 0) {
            return interaction.editReply({
                content: `📭 Nenhum comprovante registrado para semana ${semanaNumero} de ${ano}.`
            });
        }
        
        const embed = new EmbedBuilder()
            .setTitle(`📋 COMPROVANTES - Semana ${semanaNumero}`)
            .setColor(0x3498DB)
            .setDescription(`**Total de comprovantes:** ${comprovantes.length}\n**Valor total pago:** $${comprovantes.reduce((sum, c) => sum + (c.valor_pago || 0), 0).toLocaleString('pt-BR')}`);
        
        comprovantes.forEach((comp, index) => {
            embed.addFields({
                name: `${index + 1}. ${comp.membro_nome}`,
                value: `💰 **Valor:** $${comp.valor_pago?.toLocaleString('pt-BR') || '0'}\n🛠️ **Por:** ${comp.enviado_por_nome}\n📅 **Data:** ${new Date(comp.data_envio).toLocaleDateString('pt-BR')}\n${comp.observacao ? `📝 **Obs:** ${comp.observacao}` : ''}`,
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

module.exports = {
    mostrarModalComprovante,
    processarModalComprovante,
    verificarComprovante,
    listarComprovantes
};