#include <stdio.h>
#include <stdint.h>
#include <string.h>

__device__ void md5(const uint8_t *initial_msg, size_t initial_len, uint8_t *digest) {
    uint32_t h0 = 0x67452301, h1 = 0xefcdab89;
    uint32_t h2 = 0x98badcfe, h3 = 0x10325476;

    const uint32_t r[64] = {
        7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22,
        5, 9,14,20,5, 9,14,20,5, 9,14,20,5, 9,14,20,
        4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23,
        6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21
    };
    const uint32_t k[64] = {
        0xd76aa478,0xe8c7b756,0x242070db,0xc1bdceee,
        0xf57c0faf,0x4787c62a,0xa8304613,0xfd469501,
        0x698098d8,0x8b44f7af,0xffff5bb1,0x895cd7be,
        0x6b901122,0xfd987193,0xa679438e,0x49b40821,
        0xf61e2562,0xc040b340,0x265e5a51,0xe9b6c7aa,
        0xd62f105d,0x02441453,0xd8a1e681,0xe7d3fbc8,
        0x21e1cde6,0xc33707d6,0xf4d50d87,0x455a14ed,
        0xa9e3e905,0xfcefa3f8,0x676f02d9,0x8d2a4c8a,
        0xfffa3942,0x8771f681,0x6d9d6122,0xfde5380c,
        0xa4beea44,0x4bdecfa9,0xf6bb4b60,0xbebfbc70,
        0x289b7ec6,0xeaa127fa,0xd4ef3085,0x04881d05,
        0xd9d4d039,0xe6db99e5,0x1fa27cf8,0xc4ac5665,
        0xf4292244,0x432aff97,0xab9423a7,0xfc93a039,
        0x655b59c3,0x8f0ccc92,0xffeff47d,0x85845dd1,
        0x6fa87e4f,0xfe2ce6e0,0xa3014314,0x4e0811a1,
        0xf7537e82,0xbd3af235,0x2ad7d2bb,0xeb86d391
    };

    size_t new_len = initial_len + 1;
    while (new_len % 64 != 56) new_len++;

    uint8_t msg[256] = {0};
    for (size_t i = 0; i < initial_len; i++) msg[i] = initial_msg[i];
    msg[initial_len] = 0x80;

    uint64_t bits_len = 8 * (uint64_t)initial_len;
    for (int i = 0; i < 8; i++)
        msg[new_len + i] = (bits_len >> (8*i)) & 0xff;

    for (size_t offset = 0; offset < new_len + 8; offset += 64) {
        uint32_t *w = (uint32_t *)(msg + offset);
        uint32_t a = h0, b = h1, c = h2, d = h3;
        for (int i = 0; i < 64; i++) {
            uint32_t f, g;
            if (i < 16)      { f = (b & c) | (~b & d); g = i; }
            else if (i < 32) { f = (d & b) | (~d & c); g = (5*i+1) % 16; }
            else if (i < 48) { f = b ^ c ^ d;           g = (3*i+5) % 16; }
            else             { f = c ^ (b | ~d);         g = (7*i) % 16; }
            f += a + k[i] + w[g];
            a = d; d = c; c = b;
            b += (f << r[i]) | (f >> (32 - r[i]));
        }
        h0 += a; h1 += b; h2 += c; h3 += d;
    }

    uint32_t *out = (uint32_t *)digest;
    out[0] = h0; out[1] = h1; out[2] = h2; out[3] = h3;
}

__device__ void uint_to_str(uint64_t val, char *buf, int *len) {
    if (val == 0) { buf[0] = '0'; *len = 1; return; }
    char tmp[20]; int i = 0;
    while (val > 0) { tmp[i++] = '0' + (val % 10); val /= 10; }
    *len = i;
    for (int j = 0; j < i; j++) buf[j] = tmp[i-1-j];
}

__global__ void brute_force_kernel(
    const char *base, int base_len,
    const char *prefix, int prefix_len,
    uint64_t start, uint64_t count,
    uint64_t *found_nonce, uint8_t *found_hash, int *found_flag)
{
    uint64_t idx = blockIdx.x * blockDim.x + threadIdx.x;
    if (idx >= count) return;
    if (*found_flag) return;

    uint64_t nonce = start + idx;

    char msg[128];
    for (int i = 0; i < base_len; i++) msg[i] = base[i];
    char nonce_str[20]; int nonce_len;
    uint_to_str(nonce, nonce_str, &nonce_len);
    for (int i = 0; i < nonce_len; i++) msg[base_len + i] = nonce_str[i];
    int total_len = base_len + nonce_len;

    uint8_t digest[16];
    md5((const uint8_t *)msg, total_len, digest);

    const char *hexchars = "0123456789abcdef";
    char hex[33];
    for (int i = 0; i < 16; i++) {
        hex[i*2]   = hexchars[(digest[i] >> 4) & 0xf];
        hex[i*2+1] = hexchars[digest[i] & 0xf];
    }
    hex[32] = '\0';

    bool match = true;
    for (int i = 0; i < prefix_len; i++) {
        if (hex[i] != prefix[i]) { match = false; break; }
    }

    if (match) {
        if (atomicCAS(found_flag, 0, 1) == 0) {
            *found_nonce = nonce;
            for (int i = 0; i < 16; i++) found_hash[i] = digest[i];
        }
    }
}

int main(int argc, char *argv[]) {
    

    if (argc < 5) {
        printf("Uso: ./brute_force_range <cadena_base> <prefijo> <rango_inicio> <rango_fin>\n");
        printf("Ejemplo: ./brute_force_range \"hola mundo\" \"0000\" 0 100000\n");
        return 1;
    }

    const char *base   = argv[1];
    const char *prefix = argv[2];
    uint64_t range_start = (uint64_t)atoll(argv[3]);
    uint64_t range_end   = (uint64_t)atoll(argv[4]);
    int base_len   = strlen(base);
    int prefix_len = strlen(prefix);

    if (range_start > range_end) {
        printf("Error: rango_inicio debe ser menor o igual a rango_fin\n");
        return 1;
    }

    char *d_base, *d_prefix;
    uint64_t *d_nonce; uint8_t *d_hash; int *d_flag;
    uint64_t h_nonce = 0; uint8_t h_hash[16]; int h_flag = 0;

    cudaMalloc(&d_base,   base_len);
    cudaMalloc(&d_prefix, prefix_len);
    cudaMalloc(&d_nonce,  sizeof(uint64_t));
    cudaMalloc(&d_hash,   16);
    cudaMalloc(&d_flag,   sizeof(int));

    cudaMemcpy(d_base,   base,   base_len,   cudaMemcpyHostToDevice);
    cudaMemcpy(d_prefix, prefix, prefix_len, cudaMemcpyHostToDevice);
    cudaMemset(d_flag, 0, sizeof(int));

    int threads = 256;
    int blocks  = 4096;
    uint64_t batch = (uint64_t)threads * blocks;
    uint64_t current = range_start;

    printf("Buscando prefijo \"%s\" para \"%s\" en rango [%llu, %llu]...\n",
        prefix, base,
        (unsigned long long)range_start,
        (unsigned long long)range_end);

    while (current <= range_end && !h_flag) {
        uint64_t remaining = range_end - current + 1;
        uint64_t count = (remaining < batch) ? remaining : batch;

        brute_force_kernel<<<blocks, threads>>>(
            d_base, base_len, d_prefix, prefix_len,
            current, count, d_nonce, d_hash, d_flag);
        cudaError_t err = cudaGetLastError();

        if(err != cudaSuccess)
        {
            printf("Kernel error: %s\n",
                cudaGetErrorString(err));
        }

        cudaDeviceSynchronize();

        cudaMemcpy(&h_flag, d_flag, sizeof(int), cudaMemcpyDeviceToHost);
        current += count;
    }

    if (h_flag) {
        cudaMemcpy(&h_nonce, d_nonce, sizeof(uint64_t), cudaMemcpyDeviceToHost);
        cudaMemcpy(h_hash,   d_hash,  16,               cudaMemcpyDeviceToHost);
        printf("Nonce encontrado: %llu\n", (unsigned long long)h_nonce);
        printf("Hash resultante:  ");
        for (int i = 0; i < 16; i++) printf("%02x", h_hash[i]);
        printf("\n");
        printf("Input completo:   %s%llu\n", base, (unsigned long long)h_nonce);
    } else {
        printf("No se encontro solucion en el rango [%llu, %llu]\n",
            (unsigned long long)range_start,
            (unsigned long long)range_end);
    }

    cudaFree(d_base); cudaFree(d_prefix);
    cudaFree(d_nonce); cudaFree(d_hash); cudaFree(d_flag);
    return 0;
}
