const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const supabase = require('../database/supabase');

// Enviar menu de registro
async function enviarMenuRegistro(canal) {
    const embed = new EmbedBuilder()
        .setTitle('📋 REGISTRO DE MEMBROS')
        .setDescription('Bem-vindo à facção! Para se registrar, clique no botão abaixo.')
        .setColor(0x00AE86)
        .addFields(
            { name: '⚠️ ATENÇÃO', value: 'Preencha todos os campos corretamente.' },
            { name: '📋 Informações necessárias:', value: '• ID\n• Nome Completo\n• Telefone In-Game\n• Recrutador' }
        )
        .setFooter({ text: 'Sistema de Registro - Facção' });

    const botao = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('iniciar_registro')
                .setLabel('INICIAR REGISTRO')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('📝')
        );

    await canal.send({ embeds: [embed], components: [botao] });
}

// Enviar menu de pasta farm
async function enviarMenuPastaFarm(canal) {
    const embed = new EmbedBuilder()
        .setTitle('📁 CRIAR PASTA FARM INDIVIDUAL')
        .setDescription('Clique no botão abaixo para criar sua pasta farm individual.')
        .setColor(0x5865F2)
        .addFields(
            { name: 'ℹ️ Como funciona:', value: 'Será criado um canal privado apenas para você registrar seus farms.' },
            { name: '📊 Acompanhamento:', value: 'A gerência terá acesso aos seus relatórios semanais.' }
        );

    const botao = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('criar_pasta_farm')
                .setLabel('CRIAR PASTA FARM')
                .setStyle(ButtonStyle.Success)
                .setEmoji('📁')
        );

    await canal.send({ embeds: [embed], components: [botao] });
}

// Modal de registro
async function registrarMembroModal(interaction) {
    const modal = new ModalBuilder()
        .setCustomId('registro_membro_modal')
        .setTitle('Registro na Facção');

    const idInput = new TextInputBuilder()
        .setCustomId('id_input')
        .setLabel("ID (número identificador)")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("Ex: 7728")
        .setRequired(true)
        .setMaxLength(10);

    const nomeInput = new TextInputBuilder()
        .setCustomId('nome_input')
        .setLabel("Nome Completo")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("Ex: Shinous Vasconcelos")
        .setRequired(true)
        .setMaxLength(50);

    const telefoneInput = new TextInputBuilder()
        .setCustomId('telefone_input')
        .setLabel("Telefone In-Game")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("Ex: 555-1234")
        .setRequired(true)
        .setMaxLength(15);

    const recrutadorInput = new TextInputBuilder()
        .setCustomId('recrutador_input')
        .setLabel("Recrutador")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("Nome do recrutador")
        .setRequired(true)
        .setMaxLength(50);

    const primeiraLinha = new ActionRowBuilder().addComponents(idInput);
    const segundaLinha = new ActionRowBuilder().addComponents(nomeInput);
    const terceiraLinha = new ActionRowBuilder().addComponents(telefoneInput);
    const quartaLinha = new ActionRowBuilder().addComponents(recrutadorInput);

    modal.addComponents(primeiraLinha, segundaLinha, terceiraLinha, quartaLinha);

    await interaction.showModal(modal);
}

// Modal para editar farm - CORRIGIDO
async function editarFarmModal(interaction, farmLocalId) {
    const modal = new ModalBuilder()
        .setCustomId(`editar_farm_modal_${farmLocalId}`)
        .setTitle('Editar Quantidade Farmada');

    const quantidadeInput = new TextInputBuilder()
        .setCustomId('quantidade_input')
        .setLabel("Quantidade farmada")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("Digite a quantidade (ex: 1000)")
        .setRequired(true)
        .setMinLength(1)
        .setMaxLength(20);

    const linha = new ActionRowBuilder().addComponents(quantidadeInput);
    modal.addComponents(linha);

    await interaction.showModal(modal);
}

// Função para criar pasta farm
async function criarPastaFarm(interaction) {
    try {
        // Verificar se usuário está registrado
        const { data: membro, error: errorMembro } = await supabase
            .from('membros')
            .select('*')
            .eq('discord_id', interaction.user.id)
            .single();

        if (errorMembro || !membro) {
            return interaction.reply({
                content: '❌ Você precisa se registrar primeiro!',
                flags: 64
            });
        }

        // Verificar se já tem pasta
        const { data: pastaExistente } = await supabase
            .from('pastas_farm')
            .select('*')
            .eq('membro_id', membro.id)
            .eq('ativa', true)
            .single();

        if (pastaExistente) {
            return interaction.reply({
                content: '❌ Você já possui uma pasta farm ativa!',
                flags: 64
            });
        }

        // Criar canal
        const guild = interaction.guild;
        const categoria = interaction.channel.parent;
        
        const canalNome = `🟢・${membro.nome.split(' ')[0]}・${interaction.user.username}`;
        
        const canal = await guild.channels.create({
            name: canalNome,
            type: 0, // Text channel
            parent: categoria,
            permissionOverwrites: [
                {
                    id: guild.id,
                    deny: ['ViewChannel']
                },
                {
                    id: interaction.user.id,
                    allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory']
                },
                {
                    id: process.env.CARGO_GERENCIA_ID,
                    allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'ManageMessages']
                },
                {
                    id: process.env.CARGO_LIDER_ID,
                    allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'ManageMessages']
                }
            ]
        });

        // Salvar no banco de dados
        const { error } = await supabase
            .from('pastas_farm')
            .insert([
                {
                    membro_id: membro.id,
                    canal_id: canal.id,
                    ativa: true
                }
            ]);

        if (error) throw error;

        // Enviar mensagem inicial no canal
        const embed = new EmbedBuilder()
            .setTitle(`📁 PASTA FARM - ${membro.nome}`)
            .setDescription('Este é seu canal pessoal para registrar farms.')
            .setColor(0x00FF00)
            .addFields(
                { name: '📝 Como registrar:', value: 'Anexe uma imagem do baú e selecione o tipo de farm.' },
                { name: '📊 Tipos disponíveis:', value: '• Dinheiro Sujo\n• Bateria\n• Placa de Circuito' },
                { name: '⚠️ Importante:', value: 'Só anexe imagens reais de farm.' }
            )
            .setFooter({ text: `ID: ${membro.discord_id}` });

        await canal.send({ embeds: [embed] });

        await interaction.reply({
            content: `✅ Pasta farm criada com sucesso! Acesse: ${canal}`,
            flags: 64
        });

    } catch (error) {
        console.error('Erro ao criar pasta farm:', error);
        await interaction.reply({
            content: '❌ Erro ao criar pasta farm. Contate a administração.',
            flags: 64
        });
    }
}

module.exports = {
    enviarMenuRegistro,
    enviarMenuPastaFarm,
    registrarMembroModal,
    editarFarmModal,
    criarPastaFarm
};