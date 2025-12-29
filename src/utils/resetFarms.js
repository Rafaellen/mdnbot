const supabase = require('../database/supabase');

/**
 * Resetar farms pagos para uma semana específica
 * @param {number} semanaNumero - Número da semana
 * @param {number} ano - Ano
 * @param {string} userId - ID do usuário que confirmou o pagamento
 * @returns {Promise<Object>} Resultado da operação
 */
async function resetarFarmsPagados(semanaNumero, ano, userId) {
    console.log(`🔄 Resetando farms pagos - Semana ${semanaNumero} de ${ano}...`);
    
    try {
        // Buscar todos os farms da semana
        const { data: farms, error: errorFarms } = await supabase
            .from('farm_semanal')
            .select('*')
            .eq('semana_id', semanaNumero)
            .eq('ano', ano);

        if (errorFarms) {
            console.error('❌ Erro ao buscar farms para reset:', errorFarms);
            return { success: false, error: errorFarms };
        }

        console.log(`📊 Encontrados ${farms?.length || 0} farms para resetar`);

        if (!farms || farms.length === 0) {
            return { success: true, message: 'Nenhum farm encontrado para resetar' };
        }

        // Para cada farm, marcar como pago e resetar a quantidade (apenas dinheiro sujo)
        let farmsResetados = 0;
        let farmsAtualizados = [];

        for (const farm of farms) {
            if (farm.tipo_farm.toLowerCase() === 'dinheiro sujo') {
                // Atualizar o farm para marcar como pago e resetar quantidade
                const { error: updateError } = await supabase
                    .from('farm_semanal')
                    .update({
                        quantidade_original: farm.quantidade, // Salva o valor original
                        quantidade: 0, // Reseta para 0
                        pago: true,
                        pago_em: new Date().toISOString(),
                        pago_por: userId
                    })
                    .eq('id', farm.id);

                if (updateError) {
                    console.error(`❌ Erro ao resetar farm ${farm.id}:`, updateError);
                } else {
                    farmsResetados++;
                    farmsAtualizados.push({
                        id: farm.id,
                        membro_id: farm.membro_id,
                        tipo: farm.tipo_farm,
                        quantidade_original: farm.quantidade,
                        quantidade_atual: 0
                    });
                }
            }
        }

        console.log(`✅ ${farmsResetados} farms de dinheiro sujo resetados para 0`);

        return {
            success: true,
            farmsResetados,
            farmsAtualizados,
            message: `${farmsResetados} farms de dinheiro sujo foram resetados para 0`
        };

    } catch (error) {
        console.error('❌ Erro ao resetar farms pagos:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Criar registro de reset para histórico
 * @param {number} semanaNumero - Número da semana
 * @param {number} ano - Ano
 * @param {string} userId - ID do usuário que confirmou o pagamento
 * @param {number} farmsResetados - Quantidade de farms resetados
 * @returns {Promise<Object>} Resultado da operação
 */
async function criarRegistroReset(semanaNumero, ano, userId, farmsResetados) {
    try {
        const { error } = await supabase
            .from('reset_farms')
            .insert([
                {
                    semana_numero: semanaNumero,
                    ano: ano,
                    reset_por: userId,
                    reset_em: new Date().toISOString(),
                    farms_afetados: farmsResetados
                }
            ]);

        if (error) {
            console.log('ℹ️  Não foi possível criar registro de reset:', error.message);
            return { success: false, error };
        }

        console.log('✅ Registro de reset criado na tabela reset_farms');
        return { success: true };
    } catch (error) {
        console.log('ℹ️  Tabela reset_farms não existe ou erro:', error.message);
        return { success: false, error: error.message };
    }
}

module.exports = {
    resetarFarmsPagados,
    criarRegistroReset
};