const supabase = require('../src/database/supabase');

async function testPastaFarm() {
    console.log('🔍 Testando pasta farm...');
    
    // Buscar uma pasta farm ativa
    const { data: pastas, error } = await supabase
        .from('pastas_farm')
        .select('*')
        .eq('ativa', true)
        .limit(1);
    
    if (error) {
        console.error('❌ Erro ao buscar pastas:', error);
        return;
    }
    
    if (!pastas || pastas.length === 0) {
        console.log('📭 Nenhuma pasta farm ativa encontrada');
        return;
    }
    
    const pasta = pastas[0];
    console.log('✅ Pasta encontrada:');
    console.log('   ID:', pasta.id);
    console.log('   Canal ID:', pasta.canal_id);
    console.log('   Membro ID:', pasta.membro_id);
    console.log('   Ativa:', pasta.ativa);
    
    // Testar atualização
    const { error: updateError } = await supabase
        .from('pastas_farm')
        .update({ 
            ativa: false,
            semana_fechada: 3,
            ano_fechada: 2026,
            fechado_por: '733906165209235487',
            fechado_em: new Date().toISOString()
        })
        .eq('id', pasta.id);
    
    if (updateError) {
        console.error('❌ Erro ao atualizar pasta:', updateError);
    } else {
        console.log('✅ Pasta atualizada com sucesso!');
    }
}

testPastaFarm();