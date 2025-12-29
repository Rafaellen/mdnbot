const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const supabase = require('../database/supabase');

// CONFIGURAÇÕES DE PAGAMENTO
const META_SEMANAL_SUJO = 200000; // Meta semanal por membro: 200.000
const PORCENTAGEM_MEMBRO = 0.60; // 60% para o membro após meta
const PORCENTAGEM_FAMILIA = 0.40; // 40% para a família após meta

module.exports = {
    data: new SlashCommandBuilder()
        .setName('fecharpastas')
        .setDescription('Fechar todas as pastas farms e gerar resumo semanal')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    
    async execute(interaction) {
        console.log(`🔧 /fecharpastas executado por: ${interaction.user.tag} (${interaction.user.id})`);
        
        // Verificar se é gerência
        const member = interaction.member;
        const cargosGerencia = [process.env.CARGO_GERENCIA_ID, process.env.CARGO_LIDER_ID];
        const temPermissao = member.roles.cache.some(role => cargosGerencia.includes(role.id));
        
        if (!temPermissao) {
            console.log(`❌ ${interaction.user.tag} não tem permissão para /fecharpastas`);
            return interaction.reply({
                content: '❌ Apenas gerência pode usar este comando!',
                flags: 64
            });
        }

        console.log('⏳ Processando /fecharpastas...');
        await interaction.deferReply();

        try {
            // Obter semana atual
            const data = new Date();
            const semanaNumero = getWeekNumber(data);
            const ano = data.getFullYear();

            console.log(`📊 Gerando resumo da semana ${semanaNumero} de ${ano}...`);
            console.log(`💰 Configurações: Meta semanal: ${META_SEMANAL_SUJO.toLocaleString('pt-BR')} | Membro: ${PORCENTAGEM_MEMBRO*100}% | Família: ${PORCENTAGEM_FAMILIA*100}%`);

            // Buscar todos os farms da semana
            const { data: farms, error: errorFarms } = await supabase
                .from('farm_semanal')
                .select(`
                    quantidade,
                    tipo_farm,
                    membros (
                        nome,
                        discord_id
                    )
                `)
                .eq('semana_id', semanaNumero)
                .eq('ano', ano);

            if (errorFarms) {
                console.error('❌ Erro ao buscar farms:', errorFarms);
                throw new Error(`Erro ao buscar farms: ${errorFarms.message}`);
            }

            console.log(`📈 Encontrados ${farms?.length || 0} farms esta semana`);

            // Calcular totais e pagamentos
            const resumo = {};
            const pagamentos = {}; // Novo: armazenar cálculos de pagamento
            let totalGeral = 0;
            let totalDinheiroSujo = 0;
            let totalPagamentoMembros = 0;
            let totalFamília = 0;
            let membrosAtivos = new Set();
            
            if (farms && farms.length > 0) {
                console.log('🔍 Processando farms encontrados:');
                farms.forEach((farm, index) => {
                    const nome = farm.membros?.nome || 'Desconhecido';
                    membrosAtivos.add(nome);
                    
                    if (!resumo[nome]) {
                        resumo[nome] = {
                            dinheiro_sujo: 0,
                            bateria: 0,
                            placa_circuito: 0,
                            total_itens: 0
                        };
                    }
                    
                    if (!pagamentos[nome]) {
                        pagamentos[nome] = {
                            dinheiro_sujo_total: 0,
                            atingiu_meta: false,
                            valor_acima_meta: 0,
                            pagamento_membro: 0,
                            pagamento_familia: 0
                        };
                    }
                    
                    // Converter tipo para chave do objeto
                    const tipo = farm.tipo_farm?.toLowerCase().replace(/\s+/g, '_') || 'desconhecido';
                    const quantidade = farm.quantidade || 0;
                    
                    console.log(`   ${index + 1}. ${nome}: ${farm.tipo_farm} -> ${tipo} = ${quantidade}`);
                    
                    if (resumo[nome][tipo] !== undefined) {
                        resumo[nome][tipo] += quantidade;
                        resumo[nome].total_itens += quantidade;
                        totalGeral += quantidade;
                        
                        // Acumular dinheiro sujo para cálculo de pagamento
                        if (tipo === 'dinheiro_sujo') {
                            pagamentos[nome].dinheiro_sujo_total += quantidade;
                            totalDinheiroSujo += quantidade;
                        }
                    } else if (tipo === 'placa_de_circuito') {
                        resumo[nome].placa_circuito += quantidade;
                        resumo[nome].total_itens += quantidade;
                        totalGeral += quantidade;
                    }
                });
                
                // CALCULAR PAGAMENTOS PARA CADA MEMBRO
                console.log('\n💰 Calculando pagamentos...');
                for (const [nome, dados] of Object.entries(pagamentos)) {
                    const dinheiroTotal = dados.dinheiro_sujo_total;
                    
                    if (dinheiroTotal > 0) {
                        console.log(`   👤 ${nome}: ${dinheiroTotal.toLocaleString('pt-BR')} dinheiro sujo`);
                        
                        // Verificar se atingiu a meta
                        if (dinheiroTotal >= META_SEMANAL_SUJO) {
                            pagamentos[nome].atingiu_meta = true;
                            const acimaMeta = dinheiroTotal - META_SEMANAL_SUJO;
                            pagamentos[nome].valor_acima_meta = acimaMeta;
                            
                            // Calcular 60% para membro, 40% para família
                            pagamentos[nome].pagamento_membro = Math.floor(acimaMeta * PORCENTAGEM_MEMBRO);
                            pagamentos[nome].pagamento_familia = Math.floor(acimaMeta * PORCENTAGEM_FAMILIA);
                            
                            totalPagamentoMembros += pagamentos[nome].pagamento_membro;
                            totalFamília += pagamentos[nome].pagamento_familia;
                            
                            console.log(`     ✅ Atingiu meta! Acima: ${acimaMeta.toLocaleString('pt-BR')}`);
                            console.log(`       💰 Membro (60%): ${pagamentos[nome].pagamento_membro.toLocaleString('pt-BR')}`);
                            console.log(`       🏠 Família (40%): ${pagamentos[nome].pagamento_familia.toLocaleString('pt-BR')}`);
                        } else {
                            pagamentos[nome].atingiu_meta = false;
                            pagamentos[nome].valor_acima_meta = 0;
                            pagamentos[nome].pagamento_membro = 0;
                            pagamentos[nome].pagamento_familia = 0;
                            console.log(`     ❌ Não atingiu meta (faltam ${(META_SEMANAL_SUJO - dinheiroTotal).toLocaleString('pt-BR')})`);
                        }
                    }
                }
                
                console.log(`\n📊 Totais finais:`);
                console.log(`   💰 Total dinheiro sujo: ${totalDinheiroSujo.toLocaleString('pt-BR')}`);
                console.log(`   👛 Total pagamento membros: ${totalPagamentoMembros.toLocaleString('pt-BR')}`);
                console.log(`   🏠 Total para família: ${totalFamília.toLocaleString('pt-BR')}`);
            }
            
            console.log('📊 Resumo calculado:', resumo);

            // 1. ENVIAR MENSAGEM DE FECHAMENTO PARA TODAS AS PASTAS
            console.log('📢 Enviando notificação de fechamento para todas as pastas...');
            await enviarNotificacaoFechamento(interaction.client, semanaNumero, ano);

            // 2. ATUALIZAR STATUS DAS PASTAS (marcar como fechadas)
            console.log('📁 Atualizando status das pastas farm...');
            const { error: errorUpdate, count: pastasAtualizadas } = await supabase
                .from('pastas_farm')
                .update({ 
                    ativa: false, 
                    semana_fechada: semanaNumero,
                    ano_fechada: ano,
                    updated_at: new Date().toISOString() 
                })
                .eq('ativa', true);

            let mensagemPastas = '';
            if (errorUpdate) {
                console.error('❌ Erro ao atualizar pastas:', errorUpdate);
                mensagemPastas = 'Não foi possível atualizar o status das pastas farm.';
            } else {
                console.log(`✅ ${pastasAtualizadas || 0} pastas farm marcadas como fechadas`);
                mensagemPastas = `🔄 ${pastasAtualizadas || 0} pastas foram fechadas.`;
            }

            // 3. CRIAR REGISTRO DA SEMANA FECHADA COM DADOS DE PAGAMENTO
            console.log('📝 Criando registro da semana fechada...');
            try {
                const dataInicio = getMonday(data);
                const dataFim = new Date(dataInicio);
                dataFim.setDate(dataFim.getDate() + 6);

                const { error: errorSemana } = await supabase
                    .from('semanas_farm')
                    .insert([
                        {
                            semana_numero: semanaNumero,
                            ano: ano,
                            data_inicio: dataInicio.toISOString().split('T')[0],
                            data_fim: dataFim.toISOString().split('T')[0],
                            fechada: true,
                            total_farms: farms?.length || 0,
                            total_itens: totalGeral,
                            total_membros: membrosAtivos.size,
                            total_dinheiro_sujo: totalDinheiroSujo,
                            total_pagamento_membros: totalPagamentoMembros,
                            total_familia: totalFamília,
                            meta_semanal: META_SEMANAL_SUJO,
                            porcentagem_membro: PORCENTAGEM_MEMBRO,
                            porcentagem_familia: PORCENTAGEM_FAMILIA,
                            fechado_por: interaction.user.id,
                            fechado_em: new Date().toISOString()
                        }
                    ]);

                if (errorSemana) {
                    console.log('ℹ️  Não foi possível registrar a semana na tabela semanas_farm:', errorSemana.message);
                } else {
                    console.log('✅ Semana registrada na tabela semanas_farm');
                }
            } catch (semanaError) {
                console.log('ℹ️  Tabela semanas_farm não existe ou erro:', semanaError.message);
            }

            // 4. CRIAR CANAL/THREAD PARA PAGAMENTO COM DETALHES
            console.log('💰 Criando sistema de pagamento...');
            const mensagemPagamento = await criarSistemaPagamento(interaction, semanaNumero, ano, resumo, pagamentos);

            // 5. CRIAR EMBED DO RESUMO COM PAGAMENTOS
            const embed = new EmbedBuilder()
                .setTitle(`📊 RESUMO SEMANAL - Semana ${semanaNumero}`)
                .setDescription(`**Relatório de todos os farms da semana ${semanaNumero} de ${ano}**\n\n💰 **Total geral:** ${totalGeral.toLocaleString('pt-BR')} itens\n👥 **Membros ativos:** ${membrosAtivos.size}\n💵 **Total dinheiro sujo:** ${totalDinheiroSujo.toLocaleString('pt-BR')}\n👛 **Pagamento total membros:** ${totalPagamentoMembros.toLocaleString('pt-BR')}\n🏠 **Total família:** ${totalFamília.toLocaleString('pt-BR')}`)
                .setColor(0x9B59B6)
                .addFields(
                    {
                        name: '💰 REGRAS DE PAGAMENTO',
                        value: `• Meta semanal: **${META_SEMANAL_SUJO.toLocaleString('pt-BR')}** dinheiro sujo\n• Após meta: **${PORCENTAGEM_MEMBRO*100}%** para membro | **${PORCENTAGEM_FAMILIA*100}%** para família`,
                        inline: false
                    }
                )
                .setTimestamp()
                .setFooter({ 
                    text: `Fechado por: ${interaction.user.username} • ${new Date().toLocaleDateString('pt-BR')}`
                });

            // Adicionar campos para cada membro com PAGAMENTO
            if (Object.keys(resumo).length > 0) {
                for (const [nome, dados] of Object.entries(resumo)) {
                    const pagamento = pagamentos[nome] || {};
                    let valorPagamento = '💰 Pagamento: **0**';
                    
                    if (pagamento.atingiu_meta) {
                        valorPagamento = `💰 Pagamento: **${pagamento.pagamento_membro.toLocaleString('pt-BR')}** (${pagamento.valor_acima_meta.toLocaleString('pt-BR')} × ${PORCENTAGEM_MEMBRO*100}%)`;
                    } else if (pagamento.dinheiro_sujo_total > 0) {
                        const falta = META_SEMANAL_SUJO - pagamento.dinheiro_sujo_total;
                        valorPagamento = `🎯 Meta não atingida: faltam **${falta.toLocaleString('pt-BR')}**`;
                    }
                    
                    embed.addFields({
                        name: `👤 ${nome}`,
                        value: `💰 Dinheiro Sujo: **${dados.dinheiro_sujo.toLocaleString('pt-BR')}**\n🔋 Bateria: **${dados.bateria.toLocaleString('pt-BR')}**\n🔌 Placa Circuito: **${dados.placa_circuito.toLocaleString('pt-BR')}**\n${valorPagamento}`,
                        inline: true
                    });
                }
            } else {
                embed.setDescription('📭 Nenhum farm registrado esta semana.');
            }

            // Adicionar status das pastas
            embed.addFields({
                name: '📁 Status das Pastas',
                value: mensagemPastas,
                inline: false
            });

            // 6. ENVIAR RESUMO FINAL
            await interaction.editReply({
                embeds: [embed],
                content: `✅ **SEMANA ${semanaNumero} FECHADA COM SUCESSO!**\n\n📊 Relatório semanal gerado com cálculos de pagamento.\n📢 Notificação enviada para todos os membros.\n💰 ${mensagemPagamento}`
            });

            console.log(`✅ /fecharpastas concluído com sucesso!`);

        } catch (error) {
            console.error('❌ Erro ao executar /fecharpastas:', error);
            await interaction.editReply({
                content: `❌ **Erro ao fechar pastas:**\n\`\`\`${error.message || 'Erro desconhecido'}\`\`\`\n\n📞 Contate o desenvolvedor.`,
                embeds: []
            });
        }
    }
};

// Função para enviar notificação para todas as pastas
async function enviarNotificacaoFechamento(client, semanaNumero, ano) {
    try {
        // Buscar todas as pastas farm ativas
        const { data: pastas, error } = await supabase
            .from('pastas_farm')
            .select('canal_id, membros(nome)')
            .eq('ativa', true);

        if (error || !pastas || pastas.length === 0) {
            console.log('ℹ️  Nenhuma pasta farm ativa encontrada.');
            return;
        }

        console.log(`📢 Enviando notificação para ${pastas.length} pastas...`);

        const notificacaoEmbed = new EmbedBuilder()
            .setTitle('🔒 FARM SEMANAL FECHADO')
            .setDescription(`**A semana ${semanaNumero} de ${ano} foi oficialmente fechada!**\n\n📊 Todos os farms desta semana foram contabilizados.\n💰 **O pagamento será processado em breve.**\n\n⏳ Aguarde as instruções de pagamento da gerência.`)
            .setColor(0xFF0000)
            .setFooter({ text: 'Sistema de Farm - Facção' })
            .setTimestamp();

        // Criar botão "Farm Pago" (apenas para gerência visualizar)
        const botaoFarmPago = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`farm_pago_${semanaNumero}_${ano}`)
                    .setLabel('💰 FARM PAGO')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('💰')
            );

        // Enviar notificação para cada pasta
        let enviadas = 0;
        for (const pasta of pastas) {
            try {
                const canal = await client.channels.fetch(pasta.canal_id);
                if (canal) {
                    await canal.send({
                        content: `@here **ATENÇÃO ${pasta.membros?.nome || 'Membro'}!**\n\nO farm da semana ${semanaNumero} foi fechado. Em breve o pagamento será feito.`,
                        embeds: [notificacaoEmbed],
                        components: [botaoFarmPago]
                    });
                    enviadas++;
                    console.log(`   ✅ Notificação enviada para ${pasta.membros?.nome || 'Desconhecido'}`);
                }
            } catch (canalError) {
                console.log(`   ❌ Erro ao enviar para canal ${pasta.canal_id}:`, canalError.message);
            }
        }

        console.log(`✅ ${enviadas}/${pastas.length} notificações enviadas com sucesso.`);

    } catch (error) {
        console.error('❌ Erro ao enviar notificações:', error);
    }
}

// Função para criar sistema de pagamento com detalhes
async function criarSistemaPagamento(interaction, semanaNumero, ano, resumo, pagamentos) {
    try {
        // Criar embed detalhado de pagamento
        const pagamentoEmbed = new EmbedBuilder()
            .setTitle(`💰 CONTROLE DE PAGAMENTO - Semana ${semanaNumero}`)
            .setDescription(`**Sistema de pagamento da semana ${semanaNumero} de ${ano}**\n\nClique nos botões abaixo para confirmar ou cancelar o pagamento.`)
            .setColor(0x00FF00)
            .addFields(
                {
                    name: '📊 TOTAIS DA SEMANA',
                    value: `👥 **Membros ativos:** ${Object.keys(resumo).length}\n💰 **Total dinheiro sujo:** ${Object.values(pagamentos).reduce((sum, p) => sum + (p.dinheiro_sujo_total || 0), 0).toLocaleString('pt-BR')}\n👛 **Pagamento total:** ${Object.values(pagamentos).reduce((sum, p) => sum + (p.pagamento_membro || 0), 0).toLocaleString('pt-BR')}`,
                    inline: false
                },
                {
                    name: '🎯 REGRAS',
                    value: `• Meta: **${META_SEMANAL_SUJO.toLocaleString('pt-BR')}** dinheiro sujo\n• Acima da meta: **${PORCENTAGEM_MEMBRO*100}%** membro | **${PORCENTAGEM_FAMILIA*100}%** família`,
                    inline: false
                }
            )
            .setTimestamp()
            .setFooter({ text: `Gerado por: ${interaction.user.username}` });

        // Adicionar detalhes por membro
        let detalhesMembros = '';
        for (const [nome, dados] of Object.entries(resumo)) {
            const pagamento = pagamentos[nome] || {};
            if (pagamento.dinheiro_sujo_total > 0) {
                detalhesMembros += `**${nome}:** ${pagamento.dinheiro_sujo_total.toLocaleString('pt-BR')} sujo`;
                
                if (pagamento.atingiu_meta) {
                    detalhesMembros += ` → ${pagamento.pagamento_membro.toLocaleString('pt-BR')} (${pagamento.valor_acima_meta.toLocaleString('pt-BR')} × ${PORCENTAGEM_MEMBRO*100}%)\n`;
                } else {
                    const falta = META_SEMANAL_SUJO - pagamento.dinheiro_sujo_total;
                    detalhesMembros += ` → ❌ Meta não atingida (falta ${falta.toLocaleString('pt-BR')})\n`;
                }
            }
        }
        
        if (detalhesMembros) {
            pagamentoEmbed.addFields({
                name: '👤 DETALHES POR MEMBRO',
                value: detalhesMembros,
                inline: false
            });
        }

        // Criar botões
        const botoesPagamento = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`confirmar_pagamento_${semanaNumero}_${ano}`)
                    .setLabel('✅ CONFIRMAR PAGAMENTO')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('✅'),
                new ButtonBuilder()
                    .setCustomId(`cancelar_pagamento_${semanaNumero}_${ano}`)
                    .setLabel('❌ CANCELAR')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('❌')
            );

        // Enviar para canal de administração (se configurado) ou canal atual
        let canalPagamento = interaction.channel;
        
        // Tentar encontrar canal de administração
        if (process.env.CANAL_ADMIN_ID) {
            try {
                canalPagamento = await interaction.guild.channels.fetch(process.env.CANAL_ADMIN_ID);
            } catch (error) {
                console.log('ℹ️  Canal de admin não encontrado, usando canal atual.');
            }
        }

        await canalPagamento.send({
            content: `**💰 CONTROLE DE PAGAMENTO - SEMANA ${semanaNumero}**\n\n@here A gerência deve confirmar o pagamento abaixo:`,
            embeds: [pagamentoEmbed],
            components: [botoesPagamento]
        });

        return `Sistema de pagamento criado em ${canalPagamento}.`;

    } catch (error) {
        console.error('❌ Erro ao criar sistema de pagamento:', error);
        return 'Sistema de pagamento não pôde ser criado.';
    }
}

// Função auxiliar para obter segunda-feira
function getMonday(d) {
    d = new Date(d);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    return new Date(d.setDate(diff));
}

// Função para obter número da semana
function getWeekNumber(d) {
    d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return weekNo;
}