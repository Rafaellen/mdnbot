const { Events, ActionRowBuilder, StringSelectMenuBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
    name: Events.MessageCreate,
    async execute(message) {
        // Ignorar mensagens do bot
        if (message.author.bot) return;

        console.log(`📨 Nova mensagem em #${message.channel.name} de ${message.author.tag}`);

        try {
            // VERIFICAR SE É UMA IMAGEM EM CANAL DE PASTA FARM
            if (message.attachments.size > 0 && message.attachments.first().contentType?.startsWith('image/')) {
                console.log(`🖼️ Imagem detectada de ${message.author.tag} em ${message.channel.name}`);
                
                // Verificar se o canal é uma pasta farm
                const isPastaFarm = await verificarSeEPastaFarm(message.channel);
                
                if (isPastaFarm) {
                    console.log(`✅ Canal ${message.channel.name} é uma pasta farm`);
                    
                    // Verificar se o usuário é o dono da pasta ou gerência
                    const canRegisterFarm = await verificarPermissaoFarm(message);
                    
                    if (canRegisterFarm) {
                        console.log(`✅ ${message.author.tag} tem permissão para registrar farm`);
                        
                        // Verificar se é gerência (para mostrar opção de comprovante)
                        const member = await message.guild.members.fetch(message.author.id);
                        const isGerencia = member.roles.cache.has(process.env.CARGO_GERENCIA_ID) || 
                                          member.roles.cache.has(process.env.CARGO_LIDER_ID);
                        
                        // MOSTRAR DROPDOWN DE FARM (com opção de comprovante para gerência)
                        await mostrarDropdownFarm(message, isGerencia);
                    } else {
                        console.log(`❌ ${message.author.tag} não tem permissão para registrar farm neste canal`);
                        await message.react('❌');
                        await message.reply({
                            content: '❌ **Você não tem permissão para registrar farm neste canal!**\n\nEste canal é específico para outro membro.',
                            flags: 64
                        });
                    }
                } else {
                    console.log(`❌ Canal ${message.channel.name} não é uma pasta farm`);
                }
            }
            
        } catch (error) {
            console.error('❌ Erro ao processar mensagem:', error);
            // Não responder para não criar spam
        }
    },
};

// FUNÇÕES AUXILIARES

async function verificarSeEPastaFarm(channel) {
    try {
        // Verificar pelo nome do canal (contém indicadores de pasta farm)
        const channelName = channel.name.toLowerCase();
        if (channelName.includes('🟢') || channelName.includes('farm') || channelName.includes('pasta')) {
            return true;
        }
        
        // Verificar no banco de dados
        const supabase = require('../database/supabase');
        const { data: pasta, error } = await supabase
            .from('pastas_farm')
            .select('id')
            .eq('canal_id', channel.id)
            .single();
        
        return !error && pasta !== null;
        
    } catch (error) {
        console.error('❌ Erro ao verificar pasta farm:', error);
        return false;
    }
}

async function verificarPermissaoFarm(message) {
    try {
        const member = await message.guild.members.fetch(message.author.id);
        
        // Gerência sempre tem permissão
        if (member.roles.cache.has(process.env.CARGO_GERENCIA_ID) || 
            member.roles.cache.has(process.env.CARGO_LIDER_ID)) {
            return true;
        }
        
        // Verificar se o usuário é o dono da pasta
        const supabase = require('../database/supabase');
        const { data: pasta, error } = await supabase
            .from('pastas_farm')
            .select('membros(discord_id)')
            .eq('canal_id', message.channel.id)
            .single();
        
        if (error || !pasta || !pasta.membros) {
            return false;
        }
        
        return pasta.membros.discord_id === message.author.id;
        
    } catch (error) {
        console.error('❌ Erro ao verificar permissão:', error);
        return false;
    }
}

async function mostrarDropdownFarm(message, isGerencia) {
    try {
        console.log(`📋 Mostrando dropdown de farm para ${message.author.tag} (Gerência: ${isGerencia})`);
        
        // Criar menu de seleção
        const selectMenuOptions = [
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
        ];
        
        // Adicionar opção de comprovante apenas para gerência
        if (isGerencia) {
            selectMenuOptions.push({
                label: '💰 Comprovante de Pagamento',
                description: 'Registrar pagamento do farm (apenas gerência)',
                value: 'comprovante_pagamento',
                emoji: '🧾'
            });
        }
        
        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('selecionar_tipo_farm')
            .setPlaceholder(isGerencia ? 'Selecione o tipo de farm ou comprovante' : 'Selecione o tipo de farm')
            .addOptions(selectMenuOptions);

        const row = new ActionRowBuilder().addComponents(selectMenu);

        const reply = await message.reply({
            content: isGerencia 
                ? '📸 **IMAGEM DETECTADA!**\nSelecione abaixo:\n• **Farm** - Para registrar farm normal\n• **Comprovante** - Para registrar pagamento (apenas gerência)'
                : '📸 **IMAGEM DETECTADA!**\nSelecione o tipo de farm abaixo:',
            components: [row]
        });
        
        console.log(`✅ Dropdown de farm enviado para ${message.author.tag}`);
        
        // Adicionar timeout para remover dropdown após 5 minutos
        setTimeout(async () => {
            try {
                const freshMessage = await message.channel.messages.fetch(reply.id);
                if (freshMessage.components.length > 0) {
                    await freshMessage.edit({ components: [] });
                    console.log(`⏰ Dropdown expirado para mensagem de ${message.author.tag}`);
                }
            } catch (error) {
                // Mensagem já deletada ou não encontrada
            }
        }, 5 * 60 * 1000); // 5 minutos
        
    } catch (error) {
        console.error('❌ Erro ao mostrar dropdown de farm:', error);
        
        // Tentar resposta simples em caso de erro
        try {
            await message.reply({
                content: '❌ **Erro ao processar imagem!**\n\nPor favor, tente novamente ou contate a administração.',
                flags: 64
            });
        } catch (replyError) {
            console.error('Não foi possível responder:', replyError);
        }
    }
}