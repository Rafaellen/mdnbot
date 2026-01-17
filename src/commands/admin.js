const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');
const supabase = require('../database/supabase');

// CONFIGURAÇÕES DE PAGAMENTO
const META_SEMANAL_SUJO = 200000; // Meta semanal por membro: 200.000
const PORCENTAGEM_MEMBRO = 0.60; // 60% para o membro após meta
const PORCENTAGEM_FAMILIA = 0.40; // 40% para a família após meta
const PORCENTAGEM_LAVAGEM = 0.60; // 60% da lavagem (correção do exemplo)

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
            console.log(`💰 Configurações: Meta semanal: ${META_SEMANAL_SUJO.toLocaleString('pt-BR')} | Lavagem: ${PORCENTAGEM_LAVAGEM*100}% | Membro: ${PORCENTAGEM_MEMBRO*100}% | Família: ${PORCENTAGEM_FAMILIA*100}%`);

            // 1. BUSCAR TODOS OS MEMBROS CADASTRADOS
            console.log('👥 Buscando todos os membros cadastrados...');
            const { data: todosMembros, error: errorMembros } = await supabase
                .from('membros')
                .select('id, nome, discord_id')
                .eq('ativo', true);

            if (errorMembros) {
                console.error('❌ Erro ao buscar membros:', errorMembros);
                throw new Error(`Erro ao buscar membros: ${errorMembros.message}`);
            }

            console.log(`👥 Total de membros cadastrados: ${todosMembros?.length || 0}`);

            // 2. BUSCAR TODOS OS FARMS DA SEMANA
            const { data: farms, error: errorFarms } = await supabase
                .from('farm_semanal')
                .select(`
                    quantidade,
                    tipo_farm,
                    membro_id,
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

            // 3. INICIALIZAR ESTRUTURAS PARA TODOS OS MEMBROS
            const resumo = {};
            const pagamentos = {};
            const membrosComFarms = new Set();
            
            // Inicializar todos os membros (mesmo os que não farmaram)
            todosMembros.forEach(membro => {
                const nome = membro.nome || 'Desconhecido';
                
                resumo[nome] = {
                    dinheiro_sujo: 0,
                    bateria: 0,
                    placa_circuito: 0,
                    total_itens: 0,
                    discord_id: membro.discord_id,
                    membro_id: membro.id
                };
                
                pagamentos[nome] = {
                    dinheiro_sujo_total: 0,
                    atingiu_meta: false,
                    valor_acima_meta: 0,
                    valor_lavado: 0,
                    pagamento_membro: 0,
                    pagamento_familia: 0,
                    meta_atingida: META_SEMANAL_SUJO,
                    discord_id: membro.discord_id,
                    membro_id: membro.id
                };
            });
            
            // 4. PROCESSAR FARMS ENCONTRADOS
            let totalGeral = 0;
            let totalDinheiroSujo = 0;
            let totalPagamentoMembros = 0;
            let totalFamília = 0;
            
            if (farms && farms.length > 0) {
                console.log('🔍 Processando farms encontrados:');
                farms.forEach((farm, index) => {
                    const nome = farm.membros?.nome || 'Desconhecido';
                    const membroId = farm.membro_id;
                    membrosComFarms.add(nome);
                    
                    // Converter tipo para chave do objeto
                    const tipo = farm.tipo_farm?.toLowerCase().replace(/\s+/g, '_') || 'desconhecido';
                    const quantidade = farm.quantidade || 0;
                    
                    console.log(`   ${index + 1}. ${nome}: ${farm.tipo_farm} -> ${tipo} = ${quantidade}`);
                    
                    // Acumular valores
                    if (resumo[nome]) {
                        if (tipo === 'dinheiro_sujo') {
                            resumo[nome].dinheiro_sujo += quantidade;
                            pagamentos[nome].dinheiro_sujo_total += quantidade;
                            totalDinheiroSujo += quantidade;
                        } else if (tipo === 'bateria') {
                            resumo[nome].bateria += quantidade;
                        } else if (tipo === 'placa_de_circuito' || tipo === 'placa_circuito') {
                            resumo[nome].placa_circuito += quantidade;
                        }
                        
                        resumo[nome].total_itens += quantidade;
                        totalGeral += quantidade;
                    }
                });
            }
            
            console.log(`📊 Membros com farm esta semana: ${membrosComFarms.size}`);
            
            // 5. CALCULAR PAGAMENTOS PARA CADA MEMBRO (INCLUINDO OS QUE NÃO FARMARAM)
            console.log('\n💰 Calculando pagamentos para TODOS os membros...');
            for (const [nome, dados] of Object.entries(resumo)) {
                const pagamento = pagamentos[nome];
                const dinheiroTotal = pagamento.dinheiro_sujo_total;
                
                console.log(`   👤 ${nome}: ${dinheiroTotal.toLocaleString('pt-BR')} dinheiro sujo`);
                
                // Verificar se atingiu a meta
                if (dinheiroTotal >= META_SEMANAL_SUJO) {
                    pagamento.atingiu_meta = true;
                    const acimaMeta = dinheiroTotal - META_SEMANAL_SUJO;
                    pagamento.valor_acima_meta = acimaMeta;
                    
                    // Calcular lavagem: 60% do valor acima da meta
                    const valorLavado = acimaMeta * PORCENTAGEM_LAVAGEM;
                    pagamento.valor_lavado = Math.floor(valorLavado);
                    
                    // Calcular 60% para membro, 40% para família do valor lavado
                    pagamento.pagamento_membro = Math.floor(valorLavado * PORCENTAGEM_MEMBRO);
                    pagamento.pagamento_familia = Math.floor(valorLavado * PORCENTAGEM_FAMILIA);
                    
                    totalPagamentoMembros += pagamento.pagamento_membro;
                    totalFamília += pagamento.pagamento_familia;
                    
                    console.log(`     ✅ Atingiu meta! Acima: ${acimaMeta.toLocaleString('pt-BR')}`);
                    console.log(`       💰 Lavado (${PORCENTAGEM_LAVAGEM*100}%): ${pagamento.valor_lavado.toLocaleString('pt-BR')}`);
                    console.log(`       👛 Membro (${PORCENTAGEM_MEMBRO*100}%): ${pagamento.pagamento_membro.toLocaleString('pt-BR')}`);
                    console.log(`       🏠 Família (${PORCENTAGEM_FAMILIA*100}%): ${pagamento.pagamento_familia.toLocaleString('pt-BR')}`);
                } else {
                    pagamento.atingiu_meta = false;
                    pagamento.valor_acima_meta = 0;
                    pagamento.valor_lavado = 0;
                    pagamento.pagamento_membro = 0;
                    pagamento.pagamento_familia = 0;
                    
                    if (dinheiroTotal > 0) {
                        const falta = META_SEMANAL_SUJO - dinheiroTotal;
                        console.log(`     ❌ Não atingiu meta (faltam ${falta.toLocaleString('pt-BR')})`);
                    } else {
                        console.log(`     📭 Sem farm esta semana`);
                    }
                }
            }
            
            console.log(`\n📊 Totais finais:`);
            console.log(`   👥 Total membros: ${todosMembros.length}`);
            console.log(`   💰 Total dinheiro sujo: ${totalDinheiroSujo.toLocaleString('pt-BR')}`);
            console.log(`   👛 Total pagamento membros: ${totalPagamentoMembros.toLocaleString('pt-BR')}`);
            console.log(`   🏠 Total para família: ${totalFamília.toLocaleString('pt-BR')}`);
            
            // 6. CRIAR RESUMO DETALHADO
            console.log('📝 Criando resumo detalhado...');
            
            // Criar embed principal
            const embed = new EmbedBuilder()
                .setTitle(`📊 RESUMO SEMANAL COMPLETO - Semana ${semanaNumero}`)
                .setDescription(`**Relatório de TODOS os membros da semana ${semanaNumero} de ${ano}**\n\n💰 **Total geral:** ${totalGeral.toLocaleString('pt-BR')} itens\n👥 **Total membros:** ${todosMembros.length}\n💵 **Total dinheiro sujo:** ${totalDinheiroSujo.toLocaleString('pt-BR')}\n👛 **Pagamento total membros:** ${totalPagamentoMembros.toLocaleString('pt-BR')}\n🏠 **Total família:** ${totalFamília.toLocaleString('pt-BR')}`)
                .setColor(0x9B59B6)
                .addFields(
                    {
                        name: '💰 REGRAS DE PAGAMENTO',
                        value: `• Meta semanal: **${META_SEMANAL_SUJO.toLocaleString('pt-BR')}** dinheiro sujo\n• Acima da meta: **${PORCENTAGEM_LAVAGEM*100}%** lavagem\n• Do valor lavado: **${PORCENTAGEM_MEMBRO*100}%** membro | **${PORCENTAGEM_FAMILIA*100}%** família`,
                        inline: false
                    }
                )
                .setTimestamp()
                .setFooter({ 
                    text: `Fechado por: ${interaction.user.username} • ${new Date().toLocaleDateString('pt-BR')}`
                });

            // 7. CRIAR TEXTO DETALHADO PARA ANEXO
            let textoDetalhado = `📊 RESUMO SEMANAL - Semana ${semanaNumero} de ${ano}\n`;
            textoDetalhado += `📅 Data: ${new Date().toLocaleDateString('pt-BR')}\n`;
            textoDetalhado += `👤 Fechado por: ${interaction.user.username}\n`;
            textoDetalhado += `👥 Total membros: ${todosMembros.length}\n`;
            textoDetalhado += `💰 Total dinheiro sujo: ${totalDinheiroSujo.toLocaleString('pt-BR')}\n`;
            textoDetalhado += `👛 Pagamento total membros: ${totalPagamentoMembros.toLocaleString('pt-BR')}\n`;
            textoDetalhado += `🏠 Total família: ${totalFamília.toLocaleString('pt-BR')}\n\n`;
            textoDetalhado += '='.repeat(50) + '\n\n';
            textoDetalhado += 'REGRAS DE PAGAMENTO:\n';
            textoDetalhado += `• Meta semanal: ${META_SEMANAL_SUJO.toLocaleString('pt-BR')} dinheiro sujo\n`;
            textoDetalhado += `• Acima da meta: ${PORCENTAGEM_LAVAGEM*100}% lavagem\n`;
            textoDetalhado += `• Do valor lavado: ${PORCENTAGEM_MEMBRO*100}% membro | ${PORCENTAGEM_FAMILIA*100}% família\n\n`;
            textoDetalhado += '='.repeat(50) + '\n\n';

            // Adicionar detalhes por membro no embed (limitado a 25 campos)
            const membrosArray = Object.entries(resumo);
            const grupos = [];
            for (let i = 0; i < membrosArray.length; i += 25) {
                grupos.push(membrosArray.slice(i, i + 25));
            }

            // Adicionar também no texto detalhado
            textoDetalhado += 'DETALHES POR MEMBRO:\n\n';
            
            for (const [nome, dados] of Object.entries(resumo)) {
                const pagamento = pagamentos[nome];
                
                // Texto para arquivo
                textoDetalhado += `👤 ${nome}:\n`;
                textoDetalhado += `  💰 Dinheiro Sujo: ${dados.dinheiro_sujo.toLocaleString('pt-BR')}\n`;
                textoDetalhado += `  🔋 Bateria: ${dados.bateria.toLocaleString('pt-BR')}\n`;
                textoDetalhado += `  🔌 Placa Circuito: ${dados.placa_circuito.toLocaleString('pt-BR')}\n`;
                textoDetalhado += `  📊 Total itens: ${dados.total_itens.toLocaleString('pt-BR')}\n`;
                
                if (pagamento.atingiu_meta) {
                    textoDetalhado += `  ✅ Meta: ATINGIDA\n`;
                    textoDetalhado += `    💰 Acima da meta: ${pagamento.valor_acima_meta.toLocaleString('pt-BR')}\n`;
                    textoDetalhado += `    🧼 Valor lavado (${PORCENTAGEM_LAVAGEM*100}%): ${pagamento.valor_lavado.toLocaleString('pt-BR')}\n`;
                    textoDetalhado += `    👛 Pagamento membro (${PORCENTAGEM_MEMBRO*100}%): ${pagamento.pagamento_membro.toLocaleString('pt-BR')}\n`;
                    textoDetalhado += `    🏠 Para família (${PORCENTAGEM_FAMILIA*100}%): ${pagamento.pagamento_familia.toLocaleString('pt-BR')}\n`;
                } else {
                    if (pagamento.dinheiro_sujo_total > 0) {
                        const falta = META_SEMANAL_SUJO - pagamento.dinheiro_sujo_total;
                        textoDetalhado += `  ❌ Meta: NÃO ATINGIDA (faltam ${falta.toLocaleString('pt-BR')})\n`;
                        textoDetalhado += `    👛 Pagamento: 0\n`;
                    } else {
                        textoDetalhado += `  📭 Sem farm esta semana\n`;
                        textoDetalhado += `    👛 Pagamento: 0\n`;
                    }
                }
                textoDetalhado += '\n' + '-'.repeat(40) + '\n\n';
            }

            // Adicionar primeiro grupo ao embed
            if (grupos.length > 0) {
                grupos[0].forEach(([nome, dados]) => {
                    const pagamento = pagamentos[nome];
                    let valorPagamento = '💰 Pagamento: **0**';
                    
                    if (pagamento.atingiu_meta) {
                        valorPagamento = `💰 Pagamento: **${pagamento.pagamento_membro.toLocaleString('pt-BR')}**\n( ${pagamento.valor_acima_meta.toLocaleString('pt-BR')} × ${PORCENTAGEM_LAVAGEM*100}% × ${PORCENTAGEM_MEMBRO*100}% )`;
                    } else if (pagamento.dinheiro_sujo_total > 0) {
                        const falta = META_SEMANAL_SUJO - pagamento.dinheiro_sujo_total;
                        valorPagamento = `🎯 Meta não atingida: faltam **${falta.toLocaleString('pt-BR')}**`;
                    } else {
                        valorPagamento = '📭 Sem farm esta semana';
                    }
                    
                    embed.addFields({
                        name: `👤 ${nome}`,
                        value: `💰 Sujo: **${dados.dinheiro_sujo.toLocaleString('pt-BR')}**\n🔋 Bateria: **${dados.bateria.toLocaleString('pt-BR')}**\n🔌 Placa: **${dados.placa_circuito.toLocaleString('pt-BR')}**\n${valorPagamento}`,
                        inline: true
                    });
                });
            }

            // 8. ENVIAR NOTIFICAÇÃO DE FECHAMENTO
            console.log('📢 Enviando notificação de fechamento para todas as pastas...');
            await enviarNotificacaoFechamento(interaction.client, semanaNumero, ano, resumo);

            // 9. ATUALIZAR STATUS DAS PASTAS
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

            // 10. CRIAR REGISTRO DA SEMANA
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
                            total_membros: todosMembros.length,
                            total_dinheiro_sujo: totalDinheiroSujo,
                            total_pagamento_membros: totalPagamentoMembros,
                            total_familia: totalFamília,
                            meta_semanal: META_SEMANAL_SUJO,
                            porcentagem_lavagem: PORCENTAGEM_LAVAGEM,
                            porcentagem_membro: PORCENTAGEM_MEMBRO,
                            porcentagem_familia: PORCENTAGEM_FAMILIA,
                            fechado_por: interaction.user.id,
                            fechado_em: new Date().toISOString()
                        }
                    ]);

                if (errorSemana) {
                    console.log('ℹ️  Não foi possível registrar a semana:', errorSemana.message);
                } else {
                    console.log('✅ Semana registrada na tabela semanas_farm');
                }
            } catch (semanaError) {
                console.log('ℹ️  Tabela semanas_farm não existe ou erro:', semanaError.message);
            }

            // 11. CRIAR ARQUIVO DE RESUMO
            const buffer = Buffer.from(textoDetalhado, 'utf-8');
            const attachment = new AttachmentBuilder(buffer, { 
                name: `resumo_semana_${semanaNumero}_${ano}.txt`,
                description: `Resumo detalhado da semana ${semanaNumero}`
            });

            // 12. CRIAR BOTÕES PARA GERÊNCIA
            const botoesGerencia = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`enviar_comprovante_${semanaNumero}_${ano}`)
                        .setLabel('📎 ENVIAR COMPROVANTE')
                        .setStyle(ButtonStyle.Primary)
                        .setEmoji('📎'),
                    new ButtonBuilder()
                        .setCustomId(`ver_detalhes_${semanaNumero}_${ano}`)
                        .setLabel('📊 VER DETALHES')
                        .setStyle(ButtonStyle.Secondary)
                        .setEmoji('📊'),
                    new ButtonBuilder()
                        .setCustomId(`gerar_pagamentos_${semanaNumero}_${ano}`)
                        .setLabel('💰 GERAR PAGAMENTOS')
                        .setStyle(ButtonStyle.Success)
                        .setEmoji('💰')
                );

            // 13. ENVIAR RESUMO FINAL
            await interaction.editReply({
                embeds: [embed],
                content: `✅ **SEMANA ${semanaNumero} FECHADA COM SUCESSO!**\n\n📊 Relatório semanal completo gerado.\n👥 **${todosMembros.length} membros** incluídos no relatório.\n📝 Verifique o arquivo anexo para detalhes completos.`,
                files: [attachment],
                components: [botoesGerencia]
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

// Função para enviar notificação para todas as pastas COM BOTÃO DE COMPROVANTE
async function enviarNotificacaoFechamento(client, semanaNumero, ano, resumo) {
    try {
        // Buscar todas as pastas farm ativas
        const { data: pastas, error } = await supabase
            .from('pastas_farm')
            .select('canal_id, membros(id, nome, discord_id)')
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

        // Criar botão para enviar comprovante (apenas para o membro da pasta)
        let enviadas = 0;
        for (const pasta of pastas) {
            try {
                const canal = await client.channels.fetch(pasta.canal_id);
                if (canal) {
                    const membroNome = pasta.membros?.nome || 'Membro';
                    const membroDiscordId = pasta.membros?.discord_id;
                    
                    // Verificar se o membro tem farm na semana
                    const temFarm = Object.values(resumo).some(m => 
                        m.membro_id === pasta.membros?.id && m.dinheiro_sujo > 0
                    );
                    
                    // Criar botão específico para este canal
                    const botaoComprovante = new ActionRowBuilder()
                        .addComponents(
                            new ButtonBuilder()
                                .setCustomId(`upload_comprovante_${semanaNumero}_${ano}_${pasta.canal_id}`)
                                .setLabel('📎 ENVIAR COMPROVANTE')
                                .setStyle(ButtonStyle.Success)
                                .setEmoji('📎')
                                .setDisabled(!temFarm) // Desabilitar se não tem farm
                        );
                    
                    await canal.send({
                        content: `@here **ATENÇÃO ${membroNome}!**\n\nO farm da semana ${semanaNumero} foi fechado. ${temFarm ? 'Você tem pagamento pendente!' : 'Você não teve farm esta semana.'}`,
                        embeds: [notificacaoEmbed],
                        components: temFarm ? [botaoComprovante] : []
                    });
                    
                    enviadas++;
                    console.log(`   ✅ Notificação enviada para ${membroNome} ${temFarm ? '(com pagamento)' : '(sem pagamento)'}`);
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