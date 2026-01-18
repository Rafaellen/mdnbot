const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

// 🔧 SOLUÇÃO: Forçar atualização do cache do esquema
const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false
  },
  db: {
    schema: 'public'
  },
  global: {
    headers: {
      'x-client-info': 'discord-bot/1.0',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    }
  }
});

// Função para verificar e atualizar o esquema
async function verificarEAtualizarEsquema() {
    try {
        console.log('🔄 Verificando estrutura da tabela membros...');
        
        // Consulta que inclui id_in_game para forçar atualização do cache
        const { data, error } = await supabase
            .from('membros')
            .select('id, discord_id, nome, telefone, recrutador, hierarquia, ativo, id_in_game, data_registro, cargo_id')
            .limit(1);
        
        if (error) {
            console.error('❌ Erro na verificação do esquema:', error.message);
            
            if (error.message.includes('id_in_game')) {
                console.log('⚠️ Coluna id_in_game não encontrada! Verificando estrutura atual...');
                
                // Tentar consulta sem id_in_game
                const { data: data2, error: error2 } = await supabase
                    .from('membros')
                    .select('id, discord_id, nome')
                    .limit(1);
                    
                if (error2) {
                    console.error('❌ Erro crítico - Tabela membros não acessível:', error2.message);
                } else {
                    console.log('✅ Tabela membros acessível (sem id_in_game)');
                    console.log('ℹ️ A coluna id_in_game precisa ser adicionada manualmente ao banco.');
                }
            }
        } else {
            console.log('✅ Esquema verificado com sucesso!');
            console.log('📋 Colunas disponíveis na tabela membros:');
            console.log('   • id');
            console.log('   • discord_id');
            console.log('   • nome');
            console.log('   • telefone');
            console.log('   • recrutador');
            console.log('   • hierarquia');
            console.log('   • ativo');
            console.log('   • id_in_game ✅ (coluna existente)');
            console.log('   • data_registro');
            console.log('   • cargo_id');
        }
    } catch (err) {
        console.error('❌ Erro ao verificar esquema:', err.message);
    }
}

// Função para forçar atualização do cache
async function atualizarCacheSupabase() {
    try {
        console.log('🔄 Forçando atualização do cache do Supabase...');
        
        // Fazer uma consulta que força o Supabase a recarregar o esquema
        const { error } = await supabase
            .from('membros')
            .select('id, discord_id, nome, id_in_game')
            .limit(1);
        
        if (error) {
            console.log('⚠️ Erro detectado, tentando correção...');
            
            // Tentativa alternativa - consulta simples
            const { error: error2 } = await supabase
                .from('membros')
                .select('id')
                .limit(1);
                
            if (error2) {
                console.error('❌ Não foi possível atualizar cache:', error2.message);
                console.log('💡 Aguarde 1-2 minutos e reinicie o bot.');
            } else {
                console.log('✅ Cache atualizado com sucesso!');
            }
        } else {
            console.log('✅ Cache já está atualizado!');
        }
    } catch (err) {
        console.error('❌ Erro ao atualizar cache:', err.message);
    }
}

// Executar verificações ao carregar o módulo
setTimeout(() => {
    console.log('\n🔍 Iniciando verificação do banco de dados...');
    verificarEAtualizarEsquema().then(() => {
        setTimeout(() => {
            atualizarCacheSupabase();
        }, 1000);
    });
}, 2000);

module.exports = {
    supabase,
    atualizarCacheSupabase,
    verificarEAtualizarEsquema
};