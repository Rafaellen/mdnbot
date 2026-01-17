const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');
const supabase = require('../database/supabase');

// CONFIGURAÇÕES DE PAGAMENTO
const META_SEMANAL_SUJO = 200000; // Meta semanal por membro: 200.000
const PORCENTAGEM_MEMBRO = 0.60; // 60% para o membro após meta
const PORCENTAGEM_FAMILIA = 0.40; // 40% para a família após meta
const PORCENTAGEM_LAVAGEM = 0.60; // 60% da lavagem

module.exports = {
    data: new SlashCommandBuilder()
        .setName('fecharpastas')
        .setDescription('Fechar todas as pastas farms e gerar resumo semanal'),
    
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
        
        // TENTAR deferReply com tratamento de erro robusto
        try {
            await interaction.deferReply();
            console.log('✅ deferReply bem-sucedido');
        } catch (deferError) {
            console.error('❌ Erro ao defer reply:', deferError.message);
            
            // Tentar responder normalmente
            try {
                await interaction.reply({
                    content: '⏳ Processando comando...',
                    flags: 64
                });
            } catch (replyError) {
                console.error('❌ Não foi possível responder:', replyError.message);
                return;
            }
        }

        try {
            // Obter semana atual
            const data = new Date();
            const semanaNumero = getWeekNumber(data);
            const ano = data.getFullYear();

            console.log(`📊 Gerando resumo da semana ${semanaNumero} de ${ano}...`);

            // 1. BUSCAR TODOS OS MEMBROS CADASTRADOS
            console.log('👥 Buscando todos os membros cadastrados...');
            
            let todosMembros = [];
            try {
                const { data: membrosData, error: membrosError } = await supabase
                    .from('membros')
                    .select('id, nome, discord_id, ativo')
                    .order('nome');
                
                if (membrosError) {
                    console.log('⚠️ Erro ao buscar membros:', membrosError.message);
                    const { data: membrosData2, error: membrosError2 } = await supabase
                        .from('membros')
                        .select('id, nome, discord_id')
                        .order('nome');
                    
                    if (membrosError2) {
                        throw new Error(`Erro ao buscar membros: ${membrosError2.message}`);
                    }
                    
                    todosMembros = membrosData2 || [];
                } else {
                    todosMembros = (membrosData || []).filter(m => m.ativo !== false);
                }
            } catch (error) {
                console.error('❌ Erro ao buscar membros:', error);
                throw new Error(`Erro ao buscar membros: ${error.message}`);
            }

            if (todosMembros.length === 0) {
                throw new Error('Nenhum membro encontrado no banco de dados!');
            }

            console.log(`👥 Total de membros a processar: ${todosMembros.length}`);

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

            // 3. INICIALIZAR ESTRUTURAS
            const resumo = {};
            const pagamentos = {};
            
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
            
            // 4. PROCESSAR FARMS
            let totalGeral = 0;
            let totalDinheiroSujo = 0;
            let totalPagamentoMembros = 0;
            let totalFamília = 0;
            
            if (farms && farms.length > 0) {
                farms.forEach((farm) => {
                    const nome = farm.membros?.nome || 'Desconhecido';
                    const tipo = farm.tipo_farm?.toLowerCase().replace(/\s+/g, '_') || 'desconhecido';
                    const quantidade = farm.quantidade || 0;
                    
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
            
            // 5. CALCULAR PAGAMENTOS
            console.log('\n💰 Calculando pagamentos...');
            for (const [nome, dados] of Object.entries(resumo)) {
                const pagamento = pagamentos[nome];
                const dinheiroTotal = pagamento.dinheiro_sujo_total;
                
                if (dinheiroTotal >= META_SEMANAL_SUJO) {
                    pagamento.atingiu_meta = true;
                    const acimaMeta = dinheiroTotal - META_SEMANAL_SUJO;
                    pagamento.valor_acima_meta = acimaMeta;
                    
                    const valorLavado = acimaMeta * PORCENTAGEM_LAVAGEM;
                    pagamento.valor_lavado = Math.floor(valorLavado);
                    
                    pagamento.pagamento_membro = Math.floor(valorLavado * PORCENTAGEM_MEMBRO);
                    pagamento.pagamento_familia = Math.floor(valorLavado * PORCENTAGEM_FAMILIA);
                    
                    totalPagamentoMembros += pagamento.pagamento_membro;
                    totalFamília += pagamento.pagamento_familia;
                } else {
                    pagamento.atingiu_meta = false;
                    pagamento.valor_acima_meta = 0;
                    pagamento.valor_lavado = 0;
                    pagamento.pagamento_membro = 0;
                    pagamento.pagamento_familia = 0;
                }
            }
            
            console.log(`\n📊 Totais finais:`);
            console.log(`   👥 Total membros: ${todosMembros.length}`);
            console.log(`   💰 Total dinheiro sujo: ${totalDinheiroSujo.toLocaleString('pt-BR')}`);
            console.log(`   👛 Total pagamento membros: ${totalPagamentoMembros.toLocaleString('pt-BR')}`);
            console.log(`   🏠 Total para família: ${totalFamília.toLocaleString('pt-BR')}`);
            
            // 6. CRIAR RESUMO DETALHADO
            console.log('📝 Criando resumo detalhado...');
            
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

            // Adicionar alguns membros ao embed (limitado)
            const membrosComFarm = Object.entries(resumo).filter(([_, dados]) => dados.dinheiro_sujo > 0);
            const membrosParaMostrar = membrosComFarm.slice(0, 15);
            
            if (membrosParaMostrar.length > 0) {
                let membrosText = '';
                membrosParaMostrar.forEach(([nome, dados]) => {
                    const pagamento = pagamentos[nome];
                    if (pagamento.atingiu_meta) {
                        membrosText += `**${nome}**: ${dados.dinheiro_sujo.toLocaleString('pt-BR')} → $${pagamento.pagamento_membro.toLocaleString('pt-BR')}\n`;
                    } else {
                        membrosText += `**${nome}**: ${dados.dinheiro_sujo.toLocaleString('pt-BR')} → Meta não atingida\n`;
                    }
                });
                
                if (membrosComFarm.length > 15) {
                    membrosText += `\n... e mais ${membrosComFarm.length - 15} membros`;
                }
                
                embed.addFields({
                    name: '👤 MEMBROS COM FARM',
                    value: membrosText || 'Nenhum farm esta semana',
                    inline: false
                });
            }

            // 7. ENVIAR NOTIFICAÇÃO PARA TODAS AS PASTAS
            console.log('📢 Enviando notificação para todas as pastas...');
            await enviarNotificacaoFechamento(interaction.client, semanaNumero, ano, resumo, pagamentos);

            // 8. ATUALIZAR STATUS DAS PASTAS
            console.log('📁 Atualizando status das pastas farm...');
            const { error: errorUpdate } = await supabase
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
                mensagemPastas = 'Todas as pastas foram fechadas.';
            }

            // 9. CRIAR ARQUIVO DE RESUMO
            let textoDetalhado = `📊 RESUMO SEMANAL - Semana ${semanaNumero} de ${ano}\n`;
            textoDetalhado += `📅 Data: ${new Date().toLocaleDateString('pt-BR')}\n`;
            textoDetalhado += `👤 Fechado por: ${interaction.user.username}\n`;
            textoDetalhado += `👥 Total membros: ${todosMembros.length}\n`;
            textoDetalhado += `💰 Total dinheiro sujo: ${totalDinheiroSujo.toLocaleString('pt-BR')}\n`;
            textoDetalhado += `👛 Pagamento total membros: ${totalPagamentoMembros.toLocaleString('pt-BR')}\n`;
            textoDetalhado += `🏠 Total família: ${totalFamília.toLocaleString('pt-BR')}\n\n`;
            textoDetalhado += '='.repeat(50) + '\n\n';
            
            // Detalhes por membro
            textoDetalhado += 'DETALHES POR MEMBRO:\n\n';
            for (const [nome, dados] of Object.entries(resumo)) {
                const pagamento = pagamentos[nome];
                
                textoDetalhado += `👤 ${nome}:\n`;
                textoDetalhado += `  💰 Dinheiro Sujo: ${dados.dinheiro_sujo.toLocaleString('pt-BR')}\n`;
                textoDetalhado += `  🔋 Bateria: ${dados.bateria.toLocaleString('pt-BR')}\n`;
                textoDetalhado += `  🔌 Placa Circuito: ${dados.placa_circuito.toLocaleString('pt-BR')}\n`;
                textoDetalhado += `  📊 Total itens: ${dados.total_itens.toLocaleString('pt-BR')}\n`;
                
                if (pagamento.atingiu_meta) {
                    textoDetalhado += `  ✅ Meta: ATINGIDA\n`;
                    textoDetalhado += `    💰 Acima da meta: ${pagamento.valor_acima_meta.toLocaleString('pt-BR')}\n`;
                    textoDetalhado += `    👛 Pagamento: ${pagamento.pagamento_membro.toLocaleString('pt-BR')}\n`;
                } else {
                    if (pagamento.dinheiro_sujo_total > 0) {
                        const falta = META_SEMANAL_SUJO - pagamento.dinheiro_sujo_total;
                        textoDetalhado += `  ❌ Meta: NÃO ATINGIDA (faltam ${falta.toLocaleString('pt-BR')})\n`;
                    } else {
                        textoDetalhado += `  📭 Sem farm esta semana\n`;
                    }
                    textoDetalhado += `    👛 Pagamento: 0\n`;
                }
                textoDetalhado += '\n' + '-'.repeat(40) + '\n\n';
            }

            const buffer = Buffer.from(textoDetalhado, 'utf-8');
            const attachment = new AttachmentBuilder(buffer, { 
                name: `resumo_semana_${semanaNumero}_${ano}.txt`,
                description: `Resumo detalhado da semana ${semanaNumero}`
            });

            // 10. RESETAR CONTAGEM DE DINHEIRO SUJO (MANTENDO REGISTROS HISTÓRICOS)
            console.log('\n🔄 RESETANDO CONTAGEM DE DINHEIRO SUJO PARA NOVA SEMANA...');
            
            let mensagemReset = '';
            try {
                // Buscar todos os registros de dinheiro sujo da semana
                const { data: farmsSujo, error: farmsError } = await supabase
                    .from('farm_semanal')
                    .select('id, quantidade, membro_id, tipo_farm, membros(nome)')
                    .eq('semana_id', semanaNumero)
                    .eq('ano', ano)
                    .eq('tipo_farm', 'Dinheiro Sujo');

                if (farmsError) {
                    console.error('❌ Erro ao buscar farms de dinheiro sujo:', farmsError);
                    mensagemReset = '⚠️ Não foi possível buscar registros para resetar.';
                } else {
                    const totalRegistros = farmsSujo?.length || 0;
                    console.log(`📊 Encontrados ${totalRegistros} registros de dinheiro sujo para resetar`);
                    
                    if (totalRegistros > 0) {
                        let resetados = 0;
                        
                        // Para cada registro, salvar o valor original e zerar a quantidade
                        for (const farm of farmsSujo) {
                            const { error: updateError } = await supabase
                                .from('farm_semanal')
                                .update({ 
                                    quantidade_original: farm.quantidade, // Salvar valor original
                                    quantidade: 0, // Zerar para próxima semana
                                    pago: true,
                                    pago_em: new Date().toISOString(),
                                    pago_por: interaction.user.id
                                })
                                .eq('id', farm.id);
                            
                            if (updateError) {
                                console.error(`❌ Erro ao resetar farm ${farm.id}:`, updateError);
                            } else {
                                resetados++;
                                console.log(`   ✅ ${farm.membros?.nome || 'Membro'}: ${farm.quantidade.toLocaleString('pt-BR')} → 0`);
                            }
                        }
                        
                        mensagemReset = `🔄 ${resetados}/${totalRegistros} registros de dinheiro sujo resetados para 0.`;
                        console.log(`✅ ${resetados} registros resetados com sucesso!`);
                    } else {
                        mensagemReset = '📭 Nenhum registro de dinheiro sujo encontrado para resetar.';
                        console.log('📭 Nenhum registro de dinheiro sujo para resetar');
                    }
                }
            } catch (resetError) {
                console.error('❌ Erro no processo de reset:', resetError);
                mensagemReset = '⚠️ Erro ao resetar contagem de dinheiro sujo.';
            }

            // 11. ENVIAR RESUMO FINAL
            await interaction.editReply({
                embeds: [embed],
                content: `✅ **SEMANA ${semanaNumero} FECHADA COM SUCESSO!**\n\n📊 Relatório semanal completo gerado.\n👥 **${todosMembros.length} membros** incluídos no relatório.\n🔄 **${mensagemReset}**\n📝 Verifique o arquivo anexo para detalhes completos.\n\n${mensagemPastas}`,
                files: [attachment]
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

// Função para enviar notificação para todas as pastas com botão "FECHAR FARM"
async function enviarNotificacaoFechamento(client, semanaNumero, ano, resumo, pagamentos) {
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

        let enviadas = 0;
        for (const pasta of pastas) {
            try {
                const canal = await client.channels.fetch(pasta.canal_id);
                if (canal) {
                    const membroNome = pasta.membros?.nome || 'Membro';
                    const membroDiscordId = pasta.membros?.discord_id;
                    
                    // Verificar se o membro tem farm na semana
                    let temFarm = false;
                    let valorPagamento = 0;
                    let dinheiroSujo = 0;
                    
                    // Buscar informações do membro no resumo
                    for (const [nome, dados] of Object.entries(resumo)) {
                        if (nome === membroNome) {
                            temFarm = dados.dinheiro_sujo > 0;
                            dinheiroSujo = dados.dinheiro_sujo;
                            
                            // Buscar pagamento
                            for (const [nomePag, pagamento] of Object.entries(pagamentos)) {
                                if (nomePag === membroNome) {
                                    valorPagamento = pagamento.pagamento_membro;
                                    break;
                                }
                            }
                            break;
                        }
                    }
                    
                    const notificacaoEmbed = new EmbedBuilder()
                        .setTitle('🔒 FARM SEMANAL FECHADO')
                        .setDescription(`**A semana ${semanaNumero} de ${ano} foi oficialmente fechada!**\n\n📊 Todos os farms desta semana foram contabilizados.\n💰 **Seu pagamento será processado em breve.**\n\n⏳ Aguarde as instruções de pagamento da gerência.`)
                        .setColor(0xFF0000)
                        .addFields(
                            { name: '💰 Dinheiro Sujo Farmado', value: `${dinheiroSujo.toLocaleString('pt-BR')}`, inline: true },
                            { name: '📊 Status', value: temFarm ? '✅ Com farm' : '📭 Sem farm', inline: true }
                        )
                        .setFooter({ text: 'Sistema de Farm - Facção' })
                        .setTimestamp();
                    
                    // Criar botão "FECHAR FARM" apenas para membros que farmaram
                    const botoes = new ActionRowBuilder();
                    
                    if (temFarm) {
                        botoes.addComponents(
                            new ButtonBuilder()
                                .setCustomId(`fechar_farm_${semanaNumero}_${ano}_${pasta.canal_id}_${Date.now()}`) // TIMESTAMP ADICIONADO
                                .setLabel('💰 FECHAR FARM')
                                .setStyle(ButtonStyle.Success)
                                .setEmoji('💰')
                        );
                    }
                    
                    // Enviar mensagem no canal com timeout e fallback
                    const mensagemConteudo = temFarm 
                        ? `@here **ATENÇÃO ${membroNome}!**\n\nO farm da semana ${semanaNumero} foi fechado. **Você tem pagamento pendente de $${valorPagamento.toLocaleString('pt-BR')}!**`
                        : `@here **ATENÇÃO ${membroNome}!**\n\nO farm da semana ${semanaNumero} foi fechado. Você não teve farm esta semana.`;
                    
                    try {
                        // Tentar com timeout
                        await Promise.race([
                            canal.send({
                                content: mensagemConteudo,
                                embeds: [notificacaoEmbed],
                                components: temFarm ? [botoes] : []
                            }),
                            new Promise((_, reject) => 
                                setTimeout(() => reject(new Error('Timeout ao enviar mensagem')), 5000)
                            )
                        ]);
                        
                        enviadas++;
                        console.log(`   ✅ Notificação enviada para ${membroNome} ${temFarm ? '(com pagamento)' : '(sem pagamento)'}`);
                        
                    } catch (sendError) {
                        console.log(`   ⚠️ Erro ao enviar para ${membroNome}:`, sendError.message);
                        
                        // Tentar sem menção @here como fallback
                        try {
                            const mensagemFallback = temFarm 
                                ? `**ATENÇÃO ${membroNome}!**\n\nO farm da semana ${semanaNumero} foi fechado. **Você tem pagamento pendente de $${valorPagamento.toLocaleString('pt-BR')}!**`
                                : `**ATENÇÃO ${membroNome}!**\n\nO farm da semana ${semanaNumero} foi fechado. Você não teve farm esta semana.`;
                            
                            await canal.send({
                                content: mensagemFallback,
                                embeds: [notificacaoEmbed],
                                components: temFarm ? [botoes] : []
                            });
                            
                            enviadas++;
                            console.log(`   ✅ Notificação enviada (fallback) para ${membroNome}`);
                        } catch (retryError) {
                            console.log(`   ❌ Falha definitiva para ${membroNome}:`, retryError.message);
                        }
                    }
                }
            } catch (canalError) {
                console.log(`   ❌ Erro ao buscar canal ${pasta.canal_id}:`, canalError.message);
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