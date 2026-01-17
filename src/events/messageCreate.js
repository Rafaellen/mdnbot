const { Events, ActionRowBuilder, StringSelectMenuBuilder, PermissionFlagsBits } = require('discord.js');
const comprovanteHandler = require('../components/comprovante');

// Cache para verificar se uma mensagem recente foi sobre comprovante
const comprovanteCache = new Map();

// Limpar cache antigo periodicamente
setInterval(() => {
    const now = Date.now();
    for (const [key, timestamp] of comprovanteCache.entries()) {
        if (now - timestamp > 5 * 60 * 1000) { // 5 minutos
            comprovanteCache.delete(key);
        }
    }
}, 60 * 1000); // A cada 1 minuto

module.exports = {
    name: Events.MessageCreate,
    async execute(message) {
        // Ignorar mensagens do bot
        if (message.author.bot) return;

        console.log(`📨 Nova mensagem em #${message.channel.name} de ${message.author.tag}`);

        try {
            // 1. VERIFICAR SE É UM COMPROVANTE
            // Primeiro, verificar se há contexto de comprovante para este canal/autor
            const cacheKey = `${message.channel.id}_${message.author.id}`;
            const hasComprovanteContext = comprovanteCache.has(cacheKey);
            
            // Se há contexto de comprovante E a mensagem tem imagem
            if (hasComprovanteContext && message.attachments.size > 0 && 
                message.attachments.first().contentType?.startsWith('image/')) {
                
                console.log(`📎 Contexto de comprovante detectado para ${message.author.tag} em ${message.channel.name}`);
                
                // Verificar se o autor é gerência
                const member = await message.guild.members.fetch(message.author.id).catch(() => null);
                if (!member) return;
                
                const isGerencia = member.roles.cache.has(process.env.CARGO_GERENCIA_ID) || 
                                  member.roles.cache.has(process.env.CARGO_LIDER_ID);
                
                if (!isGerencia) {
                    console.log(`❌ ${message.author.tag} não é gerência, ignorando contexto de comprovante`);
                    comprovanteCache.delete(cacheKey);
                    return;
                }
                
                // Processar como comprovante
                await processarComoComprovante(message, cacheKey);
                return;
            }
            
            // 2. VERIFICAR SE É UMA IMAGEM EM CANAL DE PASTA FARM
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
                        
                        // Verificar se há contexto de comprovante ativo
                        const lastBotMessage = await buscarUltimaMensagemBot(message.channel);
                        const isComprovanteFlow = lastBotMessage && 
                                                 (lastBotMessage.content.includes('COMPROVANTE') || 
                                                  lastBotMessage.content.includes('comprovante'));
                        
                        if (isComprovanteFlow) {
                            console.log(`📎 Fluxo de comprovante detectado, não mostrar dropdown de farm`);
                            // Marcar contexto de comprovante
                            comprovanteCache.set(cacheKey, Date.now());
                            return;
                        }
                        
                        // MOSTRAR DROPDOWN DE FARM
                        await mostrarDropdownFarm(message);
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
            
            // 3. VERIFICAR SE É MENSAGEM DE TEXTO EM CANAL DE PASTA FARM (para contexto de comprovante)
            if (message.content && message.content.length > 0 && !message.attachments.size) {
                const isPastaFarm = await verificarSeEPastaFarm(message.channel);
                
                if (isPastaFarm) {
                    // Verificar se a mensagem indica comprovante
                    const isComprovanteMessage = message.content.toLowerCase().includes('comprovante') ||
                                                message.content.toLowerCase().includes('pagamento') ||
                                                message.content.toLowerCase().includes('paguei') ||
                                                message.content.toLowerCase().includes('transferi');
                    
                    if (isComprovanteMessage) {
                        const member = await message.guild.members.fetch(message.author.id).catch(() => null);
                        if (!member) return;
                        
                        const isGerencia = member.roles.cache.has(process.env.CARGO_GERENCIA_ID) || 
                                          member.roles.cache.has(process.env.CARGO_LIDER_ID);
                        
                        if (isGerencia) {
                            console.log(`📎 Mensagem de comprovante detectada de ${message.author.tag}`);
                            comprovanteCache.set(cacheKey, Date.now());
                            
                            // Responder com instruções
                            await message.reply({
                                content: '📎 **DETECTADO CONTEXTO DE COMPROVANTE!**\n\nAgora anexe a imagem do comprovante. O bot NÃO irá processar como um registro de farm.',
                                flags: 64
                            });
                        }
                    }
                }
            }
            
        } catch (error) {
            console.error('❌ Erro ao processar mensagem:', error);
            // Não responder para não criar spam
        }
    },
};

// FUNÇÕES AUXILIARES

async function processarComoComprovante(message, cacheKey) {
    try {
        console.log(`📎 Processando imagem como comprovante de ${message.author.tag}`);
        
        // Adicionar reação de confirmação
        await message.react('✅');
        
        // Buscar última mensagem do bot sobre comprovante
        const messages = await message.channel.messages.fetch({ limit: 10 });
        const botMessages = messages.filter(msg => 
            msg.author.id === message.client.user.id && 
            (msg.content.includes('COMPROVANTE') || msg.content.includes('comprovante'))
        );
        
        if (botMessages.size > 0) {
            const lastBotMessage = botMessages.first();
            
            // Atualizar embed anterior se existir
            if (lastBotMessage.embeds.length > 0) {
                const originalEmbed = lastBotMessage.embeds[0];
                const embed = {
                    title: originalEmbed.title || '✅ COMPROVANTE ENVIADO',
                    description: '✅ **COMPROVANTE ENVIADO COM SUCESSO!**\n\nO pagamento foi registrado e o comprovante foi anexado.',
                    color: 0x00FF00,
                    fields: originalEmbed.fields || [],
                    timestamp: originalEmbed.timestamp || new Date().toISOString(),
                    footer: originalEmbed.footer || { text: 'Sistema de Farm - Facção' }
                };
                
                // Adicionar campo do comprovante
                embed.fields.push({
                    name: '🖼️ Comprovante',
                    value: `[Clique para ver](${message.attachments.first().url})`,
                    inline: true
                });
                
                await lastBotMessage.edit({
                    content: `✅ **COMPROVANTE DE PAGAMENTO REGISTRADO!**\n\n${originalEmbed.fields?.find(f => f.name.includes('Membro'))?.value || '👤 Membro confirmado'}`,
                    embeds: [embed]
                });
                
                console.log(`✅ Embed de comprovante atualizado para ${message.author.tag}`);
            } else {
                // Criar novo embed se não existir
                const embed = {
                    title: '✅ COMPROVANTE ENVIADO',
                    description: '✅ **COMPROVANTE ENVIADO COM SUCESSO!**',
                    color: 0x00FF00,
                    fields: [
                        {
                            name: '🖼️ Comprovante',
                            value: `[Clique para ver](${message.attachments.first().url})`,
                            inline: true
                        },
                        {
                            name: '👤 Enviado por',
                            value: message.author.toString(),
                            inline: true
                        },
                        {
                            name: '📅 Data',
                            value: new Date().toLocaleDateString('pt-BR'),
                            inline: true
                        }
                    ],
                    timestamp: new Date().toISOString(),
                    footer: { text: 'Sistema de Farm - Facção' }
                };
                
                await message.channel.send({
                    content: `✅ **COMPROVANTE REGISTRADO POR ${message.author.username}**`,
                    embeds: [embed]
                });
            }
        } else {
            // Criar nova mensagem de confirmação
            const embed = {
                title: '✅ COMPROVANTE ENVIADO',
                description: '✅ **COMPROVANTE ENVIADO COM SUCESSO!**\n\nO bot NÃO processou esta imagem como um registro de farm.',
                color: 0x00FF00,
                fields: [
                    {
                        name: '🖼️ Comprovante',
                        value: `[Clique para ver](${message.attachments.first().url})`,
                        inline: true
                    },
                    {
                        name: '👤 Enviado por',
                        value: message.author.toString(),
                        inline: true
                    },
                    {
                        name: '📅 Data',
                        value: new Date().toLocaleDateString('pt-BR'),
                        inline: true
                    }
                ],
                timestamp: new Date().toISOString(),
                footer: { text: 'Sistema de Farm - Facção' }
            };
            
            await message.channel.send({
                content: `📎 **COMPROVANTE REGISTRADO!**`,
                embeds: [embed]
            });
        }
        
        // Limpar cache após processamento
        comprovanteCache.delete(cacheKey);
        
        console.log(`✅ Comprovante processado com sucesso para ${message.author.tag}`);
        
    } catch (error) {
        console.error('❌ Erro ao processar comprovante:', error);
        comprovanteCache.delete(cacheKey);
    }
}

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

async function buscarUltimaMensagemBot(channel) {
    try {
        const messages = await channel.messages.fetch({ limit: 10 });
        const botMessages = messages.filter(msg => msg.author.id === channel.client.user.id);
        
        if (botMessages.size > 0) {
            return botMessages.first();
        }
        
        return null;
    } catch (error) {
        console.error('❌ Erro ao buscar mensagens do bot:', error);
        return null;
    }
}

async function mostrarDropdownFarm(message) {
    try {
        console.log(`📋 Mostrando dropdown de farm para ${message.author.tag}`);
        
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

        const reply = await message.reply({
            content: '📸 **IMAGEM DETECTADA!**\nSelecione o tipo de farm abaixo:',
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