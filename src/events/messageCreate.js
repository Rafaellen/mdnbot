const { Events, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');

module.exports = {
    name: Events.MessageCreate,
    async execute(message) {
        // Ignorar mensagens do bot
        if (message.author.bot) return;

        // Verificar se é mensagem com imagem em canal de pasta farm
        if (message.attachments.size > 0 && message.attachments.first().contentType?.startsWith('image/')) {
            try {
                // Verificar se é uma pasta farm (simples - apenas pelo nome)
                const channelName = message.channel.name.toLowerCase();
                if (channelName.includes('🟢') || channelName.includes('farm') || channelName.includes('pasta')) {
                    
                    // Criar menu de seleção SIMPLES
                    const selectMenu = new StringSelectMenuBuilder()
                        .setCustomId('selecionar_tipo_farm')
                        .setPlaceholder('Selecione o tipo de farm')
                        .addOptions([
                            {
                                label: 'Dinheiro Sujo',
                                description: 'Dinheiro ilegal farmado',
                                value: 'Dinheiro Sujo',
                                emoji: '💰'
                            },
                            {
                                label: 'Bateria',
                                description: 'Componente de bateria',
                                value: 'Bateria',
                                emoji: '🔋'
                            },
                            {
                                label: 'Placa de Circuito',
                                description: 'Placa de circuito eletrônico',
                                value: 'Placa de Circuito',
                                emoji: '🔌'
                            }
                        ]);

                    const row = new ActionRowBuilder().addComponents(selectMenu);

                    await message.reply({
                        content: '📸 **IMAGEM DETECTADA!**\nSelecione o tipo de farm abaixo:',
                        components: [row]
                    });
                }
            } catch (error) {
                console.error('Erro ao processar imagem:', error);
                // Não responder para não criar spam
            }
        }
    },
};