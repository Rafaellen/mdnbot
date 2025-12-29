const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const supabase = require('../database/supabase');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('resumofarm')
        .setDescription('Ver resumo de farm semanal'),
    
    async execute(interaction) {
        console.log(`🔧 /resumofarm executado por: ${interaction.user.tag} no canal: ${interaction.channel.name}`);
        
        await interaction.deferReply({ flags: 64 });

        try {
            // Verificar se está em um canal de pasta farm
            console.log(`🔍 Verificando se o canal ${interaction.channel.id} é uma pasta farm...`);
            const { data: pasta, error: errorPasta } = await supabase
                .from('pastas_farm')
                .select('membro_id')
                .eq('canal_id', interaction.channel.id)
                .single();

            if (errorPasta || !pasta) {
                console.log(`❌ Canal ${interaction.channel.name} (${interaction.channel.id}) não é uma pasta farm registrada`);
                return interaction.editReply({
                    content: '❌ **Este comando só pode ser usado em pastas farm individuais!**\n\n💡 Use este comando dentro do seu canal de farm pessoal.',
                    flags: 64
                });
            }

            console.log(`✅ Canal é uma pasta farm, membro_id: ${pasta.membro_id}`);

            // Buscar informações do membro
            const membroId = pasta.membro_id;
            const { data: membro, error: errorMembro } = await supabase
                .from('membros')
                .select('discord_id, nome, hierarquia')
                .eq('id', membroId)
                .single();

            if (errorMembro || !membro) {
                console.error('❌ Membro não encontrado:', errorMembro);
                return interaction.editReply({
                    content: '❌ **Membro não encontrado no banco de dados!**\n\n📞 Contate a administração.',
                    flags: 64
                });
            }

            console.log(`👤 Membro da pasta: ${membro.nome} (${membro.discord_id})`);

            // Verificar permissões
            const podeVer = interaction.user.id === membro.discord_id || 
                           interaction.member.roles.cache.has(process.env.CARGO_GERENCIA_ID) ||
                           interaction.member.roles.cache.has(process.env.CARGO_LIDER_ID);

            if (!podeVer) {
                console.log(`❌ ${interaction.user.tag} não tem permissão para ver resumo de ${membro.nome}`);
                return interaction.editReply({
                    content: '❌ **Você não tem permissão para ver este resumo!**\n\n🔒 Apenas o dono da pasta farm e a gerência podem ver este resumo.',
                    flags: 64
                });
            }

            // Obter semana atual
            const data = new Date();
            const semanaNumero = getWeekNumber(data);
            const ano = data.getFullYear();

            console.log(`📊 Buscando farms de ${membro.nome} na semana ${semanaNumero} de ${ano}...`);

            // Buscar farms do membro na semana
            const { data: farms, error: errorFarms } = await supabase
                .from('farm_semanal')
                .select('tipo_farm, quantidade, data_farm')
                .eq('membro_id', membroId)
                .eq('semana_id', semanaNumero)
                .eq('ano', ano)
                .order('data_farm', { ascending: false });

            if (errorFarms) {
                console.error('❌ Erro ao buscar farms:', errorFarms);
                throw new Error(`Erro ao buscar farms: ${errorFarms.message}`);
            }

            console.log(`📈 ${farms?.length || 0} farms encontrados para ${membro.nome}`);
            
            // Log para debug - ver todos os farms encontrados
            if (farms && farms.length > 0) {
                console.log('🔍 Farms encontrados:');
                farms.forEach((farm, index) => {
                    console.log(`   ${index + 1}. ${farm.tipo_farm}: ${farm.quantidade} (${farm.data_farm})`);
                });
            }

            // Calcular totais - CORRIGIDO: usar replace(/\s+/g, '_') para todos os espaços
            const totais = {
                dinheiro_sujo: 0,
                bateria: 0,
                placa_circuito: 0
            };

            let ultimoFarm = null;
            
            if (farms && farms.length > 0) {
                farms.forEach((farm, index) => {
                    // Converter tipo para chave do objeto (substituir TODOS os espaços)
                    const tipo = farm.tipo_farm?.toLowerCase().replace(/\s+/g, '_') || 'desconhecido';
                    const quantidade = farm.quantidade || 0;
                    
                    console.log(`   Processando: ${farm.tipo_farm} -> ${tipo} = ${quantidade}`);
                    
                    // Verificar se a chave existe no objeto totais
                    if (totais[tipo] !== undefined) {
                        totais[tipo] += quantidade;
                    } else {
                        console.log(`   ⚠️  Tipo não reconhecido: ${tipo} (original: ${farm.tipo_farm})`);
                        // Se for "placa_de_circuito" com underscore já, usar diretamente
                        if (tipo === 'placa_de_circuito') {
                            totais.placa_circuito += quantidade;
                        }
                    }
                    
                    // Guardar o último farm para mostrar
                    if (index === 0) {
                        ultimoFarm = {
                            tipo: farm.tipo_farm,
                            quantidade: quantidade,
                            data: farm.data_farm ? new Date(farm.data_farm).toLocaleDateString('pt-BR') : 'Data não disponível'
                        };
                    }
                });
            }
            
            console.log('📊 Totais calculados:', totais);

            // Criar embed
            const embed = new EmbedBuilder()
                .setTitle(`📊 RESUMO DE FARM - ${membro.nome}`)
                .setDescription(`**Semana ${semanaNumero} de ${ano}**`)
                .setColor(0x3498DB)
                .addFields(
                    {
                        name: '💰 Dinheiro Sujo',
                        value: `**${totais.dinheiro_sujo.toLocaleString('pt-BR')}**`,
                        inline: true
                    },
                    {
                        name: '🔋 Bateria',
                        value: `**${totais.bateria.toLocaleString('pt-BR')}**`,
                        inline: true
                    },
                    {
                        name: '🔌 Placa de Circuito',
                        value: `**${totais.placa_circuito.toLocaleString('pt-BR')}**`,
                        inline: true
                    }
                )
                .setFooter({ 
                    text: `Solicitado por: ${interaction.user.username}` 
                })
                .setTimestamp();

            // Adicionar estatísticas como um campo separado
            if (farms && farms.length > 0) {
                embed.addFields({
                    name: '📊 Estatísticas',
                    value: `• **Registros esta semana:** ${farms.length}\n• **Último farm:** ${ultimoFarm.tipo} (${ultimoFarm.quantidade.toLocaleString('pt-BR')})\n• **Data:** ${ultimoFarm.data}`,
                    inline: false
                });
            }

            await interaction.editReply({
                embeds: [embed],
                content: farms?.length > 0 ? undefined : '📭 **Nenhum farm registrado esta semana ainda.**'
            });

            console.log(`✅ Resumo de farm enviado para ${interaction.user.tag}`);

        } catch (error) {
            console.error('❌ Erro ao executar /resumofarm:', error);
            await interaction.editReply({
                content: `❌ **Erro ao gerar resumo de farm:**\n\`\`\`${error.message || 'Erro desconhecido'}\`\`\`\n\n📞 Contate a administração.`,
                flags: 64
            });
        }
    }
};

// Função para obter número da semana
function getWeekNumber(d) {
    d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return weekNo;
}