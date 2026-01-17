// Limpeza automática de dados temporários
setInterval(() => {
    if (global.encomendasTemporarias) {
        const agora = Date.now();
        const limite = 15 * 60 * 1000; // 15 minutos
        
        for (const [tempId, dados] of Object.entries(global.encomendasTemporarias)) {
            if (agora - dados.dataCriacao > limite) {
                delete global.encomendasTemporarias[tempId];
                console.log(`🧹 Encomenda temporária ${tempId} limpa automaticamente`);
            }
        }
    }
}, 5 * 60 * 1000); // Verificar a cada 5 minutos